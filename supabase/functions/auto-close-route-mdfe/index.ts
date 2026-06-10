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

type AutoCloseRequest = {
  routeId?: string;
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

    const body = (await request.json()) as AutoCloseRequest;
    const routeId = String(body.routeId || '').trim();

    if (!routeId) {
      return jsonResponse({ error: 'routeId e obrigatorio.', user_message: 'Nao foi possivel identificar a rota finalizada.' }, 400);
    }

    const { data: appUser, error: appUserError } = await adminClient
      .from('users')
      .select('id, role')
      .eq('id', user.id)
      .maybeSingle();

    if (appUserError || !appUser) {
      return jsonResponse({ error: 'Usuario nao encontrado.', user_message: 'Nao foi possivel validar o usuario atual.' }, 403);
    }

    const { data: settings, error: settingsError } = await adminClient
      .from('mdfe_settings')
      .select('enabled, auto_close_on_route_complete')
      .limit(1)
      .maybeSingle();

    if (settingsError) throw settingsError;

    if (!settings?.enabled || !settings?.auto_close_on_route_complete) {
      return jsonResponse({
        ok: true,
        closed: false,
        reason: 'auto_close_disabled',
        user_message: 'A rota foi finalizada, mas o encerramento automatico do MDF-e esta desligado nas configuracoes.',
      });
    }

    const { data: route, error: routeError } = await adminClient
      .from('routes')
      .select(`
        id,
        status,
        driver:drivers!driver_id(
          id,
          user_id
        )
      `)
      .eq('id', routeId)
      .maybeSingle();

    if (routeError) throw routeError;
    if (!route) {
      return jsonResponse({ error: 'Rota nao encontrada.', user_message: 'A rota finalizada nao foi encontrada no sistema.' }, 404);
    }

    const routeDriver = Array.isArray(route.driver) ? route.driver[0] : route.driver;
    const isAdmin = appUser.role === 'admin';
    const isAssignedDriver = String(routeDriver?.user_id || '') === String(user.id);

    if (!isAdmin && !isAssignedDriver) {
      return jsonResponse({ error: 'Usuario sem permissao para encerrar MDF-e desta rota.', user_message: 'Somente o motorista da rota ou um administrador pode finalizar esse manifesto automaticamente.' }, 403);
    }

    const { data: manifest, error: manifestError } = await adminClient
      .from('mdfe_manifests')
      .select('id, environment, focus_reference, status, unloading_uf, unloading_city_name')
      .eq('route_id', routeId)
      .in('status', ['issued', 'processing'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (manifestError) throw manifestError;

    if (!manifest) {
      return jsonResponse({
        ok: true,
        closed: false,
        reason: 'no_active_manifest',
        user_message: 'A rota foi finalizada, mas nao havia MDF-e aberto para encerrar automaticamente.',
      });
    }

    if (!manifest.focus_reference) {
      return jsonResponse(
        {
          error: 'Manifesto sem referencia Focus.',
          user_message: 'A rota foi finalizada, mas o MDF-e nao possui referencia valida para encerramento automatico.',
        },
        422
      );
    }

    if (normalizeStatus(manifest.status) !== 'issued') {
      return jsonResponse({
        ok: true,
        closed: false,
        reason: 'manifest_not_issued',
        user_message: 'A rota foi finalizada, mas o MDF-e ainda nao estava autorizado para encerramento automatico.',
      });
    }

    const closeUf = String(manifest.unloading_uf || '').trim().toUpperCase();
    const closeCityName = String(manifest.unloading_city_name || '').trim();
    const closeDate = getCurrentDate();

    if (!closeUf || closeUf.length !== 2 || !closeCityName) {
      return jsonResponse(
        {
          error: 'Dados de descarregamento incompletos.',
          user_message: 'A rota foi finalizada, mas o MDF-e nao possui cidade final suficiente para encerramento automatico.',
        },
        422
      );
    }

    const environment = normalizeEnvironment(manifest.environment);
    const focusToken = getFocusToken(environment);

    if (!focusToken) {
      return jsonResponse({ error: 'Token da Focus nao configurado no backend.', user_message: 'A rota foi finalizada, mas o token da Focus nao esta configurado no servidor.' }, 500);
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
          error: 'A Focus rejeitou o encerramento automatico do MDF-e.',
          user_message:
            resolveFocusUserMessage(focusJson) ||
            'A rota foi finalizada, mas a Focus nao aceitou o encerramento automatico do MDF-e.',
          status_code: focusResponse.status,
          focus_response: focusJson ?? responseText,
        },
        focusResponse.status >= 400 && focusResponse.status < 600 ? focusResponse.status : 502
      );
    }

    const { data: updatedManifest, error: updateError } = await adminClient
      .from('mdfe_manifests')
      .update({
        status: 'closed',
        response_json: focusJson ?? { raw: responseText },
        error_message: null,
        closed_at: new Date().toISOString(),
      })
      .eq('id', manifest.id)
      .select('id, status, mdfe_number, mdfe_key, protocol, pdf_url, issued_at, closed_at, error_message')
      .single();

    if (updateError) throw updateError;

    return jsonResponse({
      ok: true,
      closed: true,
      user_message: 'Rota finalizada e MDF-e encerrado automaticamente.',
      manifest: updatedManifest,
      focus_response: focusJson ?? responseText,
    });
  } catch (error) {
    console.error(error);
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : 'Erro interno ao encerrar MDF-e automaticamente.',
        user_message: 'A rota foi finalizada, mas ocorreu um erro interno ao encerrar o MDF-e automaticamente.',
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
