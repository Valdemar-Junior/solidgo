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

type CancelRequest = {
  manifestId?: string;
  justification?: string;
};

const MDFE_CANCELLATION_WINDOW_MS = 24 * 60 * 60 * 1000;

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
      return jsonResponse({ error: 'Apenas administradores podem cancelar MDF-e.', user_message: 'Somente administradores podem cancelar um MDF-e.' }, 403);
    }

    const body = (await request.json()) as CancelRequest;
    const manifestId = String(body.manifestId || '').trim();
    const justification = String(body.justification || '').trim();

    if (!manifestId) {
      return jsonResponse({ error: 'manifestId e obrigatorio.', user_message: 'Nao foi possivel identificar o manifesto para cancelamento.' }, 400);
    }

    if (justification.length < 15 || justification.length > 255) {
      return jsonResponse(
        {
          error: 'A justificativa do cancelamento deve ter entre 15 e 255 caracteres.',
          user_message: 'Informe uma justificativa de cancelamento com pelo menos 15 caracteres.',
        },
        422
      );
    }

    const { data: manifest, error: manifestError } = await adminClient
      .from('mdfe_manifests')
      .select('id, environment, focus_reference, status, issued_at')
      .eq('id', manifestId)
      .maybeSingle();

    if (manifestError) throw manifestError;
    if (!manifest) return jsonResponse({ error: 'Manifesto MDF-e nao encontrado.', user_message: 'O manifesto solicitado nao foi encontrado no sistema.' }, 404);
    if (!manifest.focus_reference) {
      return jsonResponse({ error: 'Manifesto sem referencia Focus.', user_message: 'Este manifesto ainda nao possui referencia valida na Focus para cancelamento.' }, 422);
    }

    const status = normalizeStatus(manifest.status);
    if (status === 'closed') {
      return jsonResponse({ error: 'Manifesto ja encerrado e nao pode ser cancelado.' }, 422);
    }
    if (status === 'cancelled') {
      return jsonResponse({ error: 'Manifesto ja esta cancelado.', user_message: 'Este MDF-e ja foi cancelado anteriormente.' }, 422);
    }

    const issuedAt = manifest.issued_at ? new Date(manifest.issued_at).getTime() : Number.NaN;
    if (!Number.isFinite(issuedAt)) {
      return jsonResponse(
        {
          error: 'Manifesto sem data de emissao valida para cancelamento.',
          user_message: 'Nao foi possivel confirmar a data de emissao deste MDF-e. Atualize o status antes de tentar novamente.',
        },
        422
      );
    }

    if (Date.now() >= issuedAt + MDFE_CANCELLATION_WINDOW_MS) {
      return jsonResponse(
        {
          error: 'Prazo de cancelamento do MDF-e expirado.',
          user_message: 'Este MDF-e foi emitido ha 24 horas ou mais e nao pode mais ser cancelado.',
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
      `${focusBaseUrl.replace(/\/$/, '')}/v2/mdfe/${encodeURIComponent(manifest.focus_reference)}`,
      {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Basic ${btoa(`${focusToken}:`)}`,
        },
        body: JSON.stringify({
          justificativa: justification,
        }),
      }
    );

    const responseText = await focusResponse.text();
    const focusJson = safeJson(responseText);

    if (!focusResponse.ok) {
      return jsonResponse(
        {
          error: 'A Focus rejeitou o cancelamento do MDF-e.',
          user_message:
            resolveFocusUserMessage(focusJson) ||
            'Nao foi possivel cancelar o MDF-e na Focus. Revise a situacao do manifesto e tente novamente.',
          status_code: focusResponse.status,
          focus_response: focusJson ?? responseText,
        },
        focusResponse.status >= 400 && focusResponse.status < 600 ? focusResponse.status : 502
      );
    }

    const updatePayload = {
      status: 'cancelled',
      response_json: focusJson ?? { raw: responseText },
      error_message: null,
      closed_at: null,
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
        error: error instanceof Error ? error.message : 'Erro interno ao cancelar MDF-e.',
        user_message: 'Ocorreu um erro interno ao cancelar o MDF-e. Tente novamente em instantes.',
      },
      500
    );
  }
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}
