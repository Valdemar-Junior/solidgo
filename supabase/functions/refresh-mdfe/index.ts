import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import { corsHeaders } from '../_shared/cors.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false },
});

type RefreshRequest = {
  manifestId?: string;
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '').trim();
    if (!token) {
      return jsonResponse({ error: 'Nao autenticado.', user_message: 'Sua sessao expirou. Entre novamente no sistema para continuar.' }, 401);
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return jsonResponse({ error: 'Sessao invalida.', user_message: 'Sua sessao nao e mais valida. Entre novamente no sistema.' }, 401);
    }

    const { data: appUser, error: appUserError } = await adminClient
      .from('users')
      .select('id, role')
      .eq('id', user.id)
      .maybeSingle();

    if (appUserError || !appUser || appUser.role !== 'admin') {
      return jsonResponse({ error: 'Apenas administradores podem consultar MDF-e.', user_message: 'Somente administradores podem consultar e atualizar o status do MDF-e.' }, 403);
    }

    const body = (await request.json()) as RefreshRequest;
    const manifestId = String(body.manifestId || '').trim();

    if (!manifestId) {
      return jsonResponse({ error: 'manifestId e obrigatorio.', user_message: 'Nao foi possivel identificar o manifesto para atualizar.' }, 400);
    }

    const { data: manifest, error: manifestError } = await adminClient
      .from('mdfe_manifests')
      .select('id, environment, focus_reference, status')
      .eq('id', manifestId)
      .maybeSingle();

    if (manifestError) throw manifestError;
    if (!manifest) return jsonResponse({ error: 'Manifesto MDF-e nao encontrado.', user_message: 'O manifesto solicitado nao foi encontrado no sistema.' }, 404);
    if (!manifest.focus_reference) {
      return jsonResponse({ error: 'Manifesto sem referencia Focus.', user_message: 'Este manifesto ainda nao possui referencia valida na Focus para consulta.' }, 422);
    }

    const environment = normalizeEnvironment(manifest.environment);
    const focusToken =
      environment === 'production'
        ? Deno.env.get('FOCUS_NFE_PRODUCTION_TOKEN') || Deno.env.get('FOCUS_NFE_TOKEN')
        : Deno.env.get('FOCUS_NFE_HOMOLOGATION_TOKEN') || Deno.env.get('FOCUS_NFE_TOKEN');

    if (!focusToken) {
      return jsonResponse({ error: 'Token da Focus nao configurado no backend.', user_message: 'O token da Focus nao esta configurado no servidor. Fale com o administrador do sistema.' }, 500);
    }

    const configuredBaseUrl = Deno.env.get('FOCUS_NFE_BASE_URL')?.trim();
    const focusBaseUrl =
      configuredBaseUrl ||
      (environment === 'production'
        ? 'https://api.focusnfe.com.br'
        : 'https://homologacao.focusnfe.com.br');

    const focusResponse = await fetch(
      `${focusBaseUrl.replace(/\/$/, '')}/v2/mdfe/${encodeURIComponent(manifest.focus_reference)}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Basic ${btoa(`${focusToken}:`)}`,
        },
      }
    );

    const responseText = await focusResponse.text();
    const focusJson = safeJson(responseText);

    if (!focusResponse.ok) {
      return jsonResponse(
        {
          error: 'A Focus rejeitou a consulta do MDF-e.',
          user_message:
            resolveFocusUserMessage(focusJson) ||
            'Nao foi possivel atualizar o status do MDF-e na Focus. Tente novamente em instantes.',
          status_code: focusResponse.status,
          focus_response: focusJson ?? responseText,
        },
        focusResponse.status >= 400 && focusResponse.status < 600 ? focusResponse.status : 502
      );
    }

    const remote = focusJson ?? {};
    const nextStatus = mapFocusStatusToLocal(remote);
    const xmlContent = remote.caminho_xml ? await fetchText(remote.caminho_xml) : null;

    const updatePayload: Record<string, unknown> = {
      status: nextStatus,
      response_json: remote,
      mdfe_number: remote.numero ? String(remote.numero) : null,
      mdfe_key: remote.chave ? String(remote.chave) : null,
      protocol: remote.protocolo ? String(remote.protocolo) : null,
      xml_content: xmlContent,
      pdf_url: remote.caminho_damdfe || null,
      error_message: nextStatus === 'error' ? resolveFocusMessage(remote) : null,
      issued_at:
        nextStatus === 'issued' || nextStatus === 'closed' || nextStatus === 'cancelled'
          ? new Date().toISOString()
          : null,
      closed_at: nextStatus === 'closed' ? new Date().toISOString() : null,
    };

    const { data: updatedManifest, error: updateError } = await adminClient
      .from('mdfe_manifests')
      .update(updatePayload)
      .eq('id', manifestId)
      .select(
        'id, status, mdfe_number, mdfe_key, protocol, pdf_url, issued_at, closed_at, error_message'
      )
      .single();

    if (updateError) throw updateError;

    return jsonResponse({
      ok: true,
      manifest: updatedManifest,
      focus_response: remote,
    });
  } catch (error) {
    console.error(error);
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : 'Erro interno ao consultar MDF-e.',
        user_message: 'Ocorreu um erro interno ao atualizar o MDF-e. Tente novamente em instantes.',
      },
      500
    );
  }
});

async function fetchText(url: string) {
  try {
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

function mapFocusStatusToLocal(payload: any) {
  const status = normalizeStatus(payload?.status);
  const sefazCode = String(payload?.status_sefaz || '').trim();

  if (status.includes('process')) return 'processing';
  if (status.includes('encerr')) return 'closed';
  if (status.includes('cancel')) return 'cancelled';
  if (status.includes('autoriz') || sefazCode === '100') return 'issued';
  if (status.includes('erro') || status.includes('rejei')) return 'error';
  return 'processing';
}

function resolveFocusMessage(payload: any) {
  return (
    payload?.mensagem_sefaz ||
    payload?.mensagem ||
    payload?.message ||
    payload?.status_sefaz ||
    null
  );
}

function resolveFocusUserMessage(payload: any) {
  return (
    payload?.mensagem_sefaz ||
    payload?.mensagem ||
    payload?.message ||
    payload?.descricao ||
    null
  );
}

function normalizeStatus(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function normalizeEnvironment(value: unknown) {
  const normalized = normalizeStatus(value);
  if (normalized === 'production' || normalized === 'producao') return 'production';
  return 'homologation';
}

function safeJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}
