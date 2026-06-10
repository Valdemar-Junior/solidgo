import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import { corsHeaders } from '../_shared/cors.ts';
import {
  getFocusBaseUrl,
  getFocusToken,
  normalizeEnvironment,
  normalizeStatus,
  resolveFocusUserMessage,
  safeJson,
} from '../_shared/focus.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false },
});

type CloseRequest = {
  manifestId?: string;
  date?: string;
  uf?: string;
  cityName?: string;
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
      return jsonResponse({ error: 'Apenas administradores podem encerrar MDF-e.', user_message: 'Somente administradores podem encerrar um MDF-e.' }, 403);
    }

    const body = (await request.json()) as CloseRequest;
    const manifestId = String(body.manifestId || '').trim();

    if (!manifestId) {
      return jsonResponse({ error: 'manifestId e obrigatorio.', user_message: 'Nao foi possivel identificar o manifesto para encerramento.' }, 400);
    }

    const { data: manifest, error: manifestError } = await adminClient
      .from('mdfe_manifests')
      .select('id, environment, focus_reference, status, unloading_uf, unloading_city_name')
      .eq('id', manifestId)
      .maybeSingle();

    if (manifestError) throw manifestError;
    if (!manifest) return jsonResponse({ error: 'Manifesto MDF-e nao encontrado.', user_message: 'O manifesto solicitado nao foi encontrado no sistema.' }, 404);
    if (!manifest.focus_reference) {
      return jsonResponse({ error: 'Manifesto sem referencia Focus.', user_message: 'Este manifesto ainda nao possui referencia valida na Focus para encerramento.' }, 422);
    }

    const status = normalizeStatus(manifest.status);
    if (status === 'closed') {
      return jsonResponse({ error: 'Manifesto ja esta encerrado.', user_message: 'Este MDF-e ja foi encerrado anteriormente.' }, 422);
    }
    if (status === 'cancelled') {
      return jsonResponse({ error: 'Manifesto cancelado nao pode ser encerrado.', user_message: 'Um MDF-e cancelado nao pode ser encerrado. Gere um novo manifesto se necessario.' }, 422);
    }

    const closeUf = String(body.uf || manifest.unloading_uf || '').trim().toUpperCase();
    const closeCityName = String(body.cityName || manifest.unloading_city_name || '').trim();
    const closeDate = String(body.date || getCurrentDate()).trim();

    if (!closeUf || closeUf.length !== 2 || !closeCityName || !closeDate) {
      return jsonResponse(
        {
          error: 'UF, municipio e data de encerramento sao obrigatorios.',
          user_message: 'Nao foi possivel montar os dados do encerramento. Revise a cidade final da rota e tente novamente.',
        },
        422
      );
    }

    const environment = normalizeEnvironment(manifest.environment);
    const focusToken = getFocusToken(environment);

    if (!focusToken) {
      return jsonResponse({ error: 'Token da Focus nao configurado no backend.', user_message: 'O token da Focus nao esta configurado no servidor. Fale com o administrador do sistema.' }, 500);
    }

    const focusBaseUrl = getFocusBaseUrl(environment);

    const focusResponse = await fetch(
      `${focusBaseUrl.replace(/\/$/, '')}/v2/mdfe/${encodeURIComponent(manifest.focus_reference)}/encerrar`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Basic ${btoa(`${focusToken}:`)}`,
        },
        body: JSON.stringify({
          data: closeDate,
          sigla_uf: closeUf,
          nome_municipio: closeCityName,
        }),
      }
    );

    const responseText = await focusResponse.text();
    const focusJson = safeJson(responseText);

    if (!focusResponse.ok) {
      return jsonResponse(
        {
          error: 'A Focus rejeitou o encerramento do MDF-e.',
          user_message:
            resolveFocusUserMessage(focusJson) ||
            'Nao foi possivel encerrar o MDF-e na Focus. Revise a situacao do manifesto e tente novamente.',
          status_code: focusResponse.status,
          focus_response: focusJson ?? responseText,
        },
        focusResponse.status >= 400 && focusResponse.status < 600 ? focusResponse.status : 502
      );
    }

    const updatePayload = {
      status: 'closed',
      response_json: focusJson ?? { raw: responseText },
      error_message: null,
      closed_at: new Date().toISOString(),
    };

    const { data: updatedManifest, error: updateError } = await adminClient
      .from('mdfe_manifests')
      .update(updatePayload)
      .eq('id', manifestId)
      .select('id, status, mdfe_number, mdfe_key, protocol, pdf_url, issued_at, closed_at, error_message')
      .single();

    if (updateError) throw updateError;

    return jsonResponse({
      ok: true,
      manifest: updatedManifest,
      focus_response: focusJson ?? responseText,
    });
  } catch (error) {
    console.error(error);
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : 'Erro interno ao encerrar MDF-e.',
        user_message: 'Ocorreu um erro interno ao encerrar o MDF-e. Tente novamente em instantes.',
      },
      500
    );
  }
});

function getCurrentDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
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
