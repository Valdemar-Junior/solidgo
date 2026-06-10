import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import { corsHeaders } from '../_shared/cors.ts';

type EmitRequest = {
  routeId?: string;
  emitterId?: string;
  vehicleId?: string;
  driverId?: string;
};

type ParsedDocument = {
  orderId: string;
  orderIdErp: string;
  customerName: string;
  xml: string;
  nfeKey: string | null;
  totalValue: number;
  grossWeight: number;
  cityCode: string | null;
  cityName: string | null;
  uf: string | null;
  blockingIssues: string[];
  warnings: string[];
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false },
});

const ALLOWED_RODADO_TYPES = new Set(['01', '02', '03', '04', '05', '06']);
const ALLOWED_BODY_TYPES = new Set(['00', '01', '02', '03', '04', '05']);

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '').trim();
    if (!token) {
      return jsonResponse({ error: 'Nao autenticado.' }, 401);
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
      return jsonResponse({ error: 'Sessao invalida.' }, 401);
    }

    const { data: appUser, error: appUserError } = await adminClient
      .from('users')
      .select('id, role')
      .eq('id', user.id)
      .maybeSingle();

    if (appUserError || !appUser || appUser.role !== 'admin') {
      return jsonResponse({ error: 'Apenas administradores podem emitir MDF-e.' }, 403);
    }

    const body = (await request.json()) as EmitRequest;
    const routeId = String(body.routeId || '').trim();
    const emitterId = String(body.emitterId || '').trim();
    const vehicleId = String(body.vehicleId || '').trim();
    const driverId = String(body.driverId || '').trim();

    if (!routeId || !emitterId || !vehicleId || !driverId) {
      return jsonResponse({ error: 'routeId, emitterId, vehicleId e driverId sao obrigatorios.' }, 400);
    }

    const [settingsResponse, emitterResponse, vehicleResponse, driverResponse, routeResponse, duplicateResponse] =
      await Promise.all([
        adminClient.from('mdfe_settings').select('*').limit(1).maybeSingle(),
        adminClient.from('mdfe_emitters').select('*').eq('id', emitterId).eq('active', true).maybeSingle(),
        adminClient.from('mdfe_vehicles').select('*').eq('id', vehicleId).eq('active', true).maybeSingle(),
        adminClient.from('mdfe_drivers').select('*').eq('id', driverId).eq('active', true).maybeSingle(),
        adminClient
          .from('routes')
          .select(`
            id,
            name,
            route_code,
            route_orders(
              id,
              sequence,
              order:orders!order_id(
                id,
                order_id_erp,
                customer_name,
                xml_documento,
                return_nfe_xml
              )
            )
          `)
          .eq('id', routeId)
          .single(),
        adminClient
          .from('mdfe_manifests')
          .select('id, status, focus_reference')
          .eq('route_id', routeId)
          .in('status', ['draft', 'processing', 'issued'])
          .limit(1)
          .maybeSingle(),
      ]);

    if (settingsResponse.error) throw settingsResponse.error;
    if (emitterResponse.error) throw emitterResponse.error;
    if (vehicleResponse.error) throw vehicleResponse.error;
    if (driverResponse.error) throw driverResponse.error;
    if (routeResponse.error) throw routeResponse.error;
    if (duplicateResponse.error) throw duplicateResponse.error;

    const settings = settingsResponse.data;
    const emitter = emitterResponse.data;
    const vehicle = vehicleResponse.data;
    const driver = driverResponse.data;
    const route = routeResponse.data as any;

    if (!settings) return jsonResponse({ error: 'Configuracao do MDF-e nao encontrada.' }, 422);
    if (!emitter) return jsonResponse({ error: 'Emitente MDF-e nao encontrado ou inativo.' }, 422);
    if (!vehicle) return jsonResponse({ error: 'Veiculo MDF-e nao encontrado ou inativo.' }, 422);
    if (!driver) return jsonResponse({ error: 'Condutor MDF-e nao encontrado ou inativo.' }, 422);

    const environment = String(settings.environment || 'homologation');
    const focusToken =
      environment === 'production'
        ? Deno.env.get('FOCUS_NFE_PRODUCTION_TOKEN') || Deno.env.get('FOCUS_NFE_TOKEN')
        : Deno.env.get('FOCUS_NFE_HOMOLOGATION_TOKEN') || Deno.env.get('FOCUS_NFE_TOKEN');

    if (!focusToken) {
      return jsonResponse({ error: 'Token da Focus nao configurado no backend.' }, 500);
    }

    const focusBaseUrl = Deno.env.get('FOCUS_NFE_BASE_URL') || 'https://api.focusnfe.com.br';

    if (duplicateResponse.data) {
      const duplicateStatus = String(duplicateResponse.data.status || '');
      const duplicateReference = String(duplicateResponse.data.focus_reference || '').trim();

      if (duplicateStatus === 'processing' && duplicateReference) {
        const remoteStatus = await reconcileManifestStatus({
          manifestId: String(duplicateResponse.data.id),
          reference: duplicateReference,
          focusBaseUrl,
          focusToken,
        });

        if (remoteStatus === 'error' || remoteStatus === 'cancelled' || remoteStatus === 'closed') {
          // libera nova tentativa
        } else {
          return jsonResponse(
            {
              error: 'Ja existe um MDF-e em aberto para esta rota.',
              manifest_id: duplicateResponse.data.id,
              status: remoteStatus || duplicateStatus,
              reference: duplicateReference,
            },
            409
          );
        }
      } else {
        return jsonResponse(
          {
            error: 'Ja existe um MDF-e em aberto para esta rota.',
            manifest_id: duplicateResponse.data.id,
            status: duplicateResponse.data.status,
            reference: duplicateResponse.data.focus_reference,
          },
          409
        );
      }
    }

    const rodadoType = String(vehicle.rodado_type || '').trim();
    const bodyType = String(vehicle.body_type || '').trim();
    const licensingUf = String(vehicle.licensing_uf || '').trim().toUpperCase();

    if (!ALLOWED_RODADO_TYPES.has(rodadoType)) {
      return jsonResponse(
        {
          error: 'O veiculo MDF-e selecionado nao possui tipo de rodado valido. Use os codigos 01 a 06 no cadastro do veiculo.',
        },
        422
      );
    }

    if (!ALLOWED_BODY_TYPES.has(bodyType)) {
      return jsonResponse(
        {
          error: 'O veiculo MDF-e selecionado nao possui tipo de carroceria valido. Use os codigos 00 a 05 no cadastro do veiculo.',
        },
        422
      );
    }

    if (!licensingUf || licensingUf.length !== 2) {
      return jsonResponse(
        {
          error: 'O veiculo MDF-e selecionado nao possui UF de licenciamento valida.',
        },
        422
      );
    }

    const loadingCityCode = cleanDigits(settings.loading_city_code) || cleanDigits(emitter.city_code);
    const loadingCityName = String(settings.loading_city_name || emitter.city_name || '').trim();
    const loadingUf = String(settings.loading_uf || emitter.uf || '').trim().toUpperCase();

    if (!loadingCityCode || !loadingCityName || !loadingUf) {
      return jsonResponse(
        { error: 'Cidade de carregamento nao configurada. Preencha o carregamento padrao no modulo MDF-e.' },
        422
      );
    }

    const routeOrders = Array.isArray(route?.route_orders) ? route.route_orders : [];
    if (routeOrders.length === 0) {
      return jsonResponse({ error: 'A rota nao possui pedidos para emissao do MDF-e.' }, 422);
    }

    const documents = routeOrders
      .sort((left: any, right: any) => Number(left.sequence || 0) - Number(right.sequence || 0))
      .map((routeOrder: any) => {
        const order = routeOrder.order;
        if (!order) {
          return {
            orderId: '',
            orderIdErp: '',
            customerName: '',
            xml: '',
            nfeKey: null,
            totalValue: 0,
            grossWeight: 0,
            cityCode: null,
            cityName: null,
            uf: null,
            blockingIssues: ['Pedido nao encontrado na rota.'],
            warnings: [],
          } satisfies ParsedDocument;
        }

        return parseNfeDocument({
          orderId: order.id,
          orderIdErp: String(order.order_id_erp || ''),
          customerName: String(order.customer_name || ''),
          xml: String(order.xml_documento || order.return_nfe_xml || '').trim(),
        });
      });

    const blockingIssues = documents.flatMap((document) =>
      document.blockingIssues.map((issue) => `Pedido ${document.orderIdErp || '-'}: ${issue}`)
    );

    if (blockingIssues.length > 0) {
      return jsonResponse(
        {
          error: 'A rota possui pendencias impeditivas para emissao do MDF-e.',
          blocking_issues: blockingIssues,
        },
        422
      );
    }

    const distinctUnloadingUfs = Array.from(
      new Set(documents.map((document) => String(document.uf || '').trim()).filter(Boolean))
    );

    if (distinctUnloadingUfs.length !== 1) {
      return jsonResponse(
        {
          error: 'A rota possui destinos em mais de uma UF. A emissao atual exige uma unica UF de descarregamento.',
          ufs: distinctUnloadingUfs,
        },
        422
      );
    }

    const unloadingGroups = new Map<
      string,
      { codigo: string; nome: string; notas_fiscais: Array<{ chave_nfe: string }> }
    >();

    for (const document of documents) {
      const key = `${document.cityCode}|${document.cityName}|${document.uf}`;
      if (!unloadingGroups.has(key)) {
        unloadingGroups.set(key, {
          codigo: String(document.cityCode),
          nome: String(document.cityName),
          notas_fiscais: [],
        });
      }

      unloadingGroups.get(key)!.notas_fiscais.push({ chave_nfe: String(document.nfeKey) });
    }

    const totalValue = documents.reduce((acc, document) => acc + Number(document.totalValue || 0), 0);
    const totalGrossWeight = documents.reduce((acc, document) => acc + Number(document.grossWeight || 0), 0);
    const lastDocument = documents[documents.length - 1];
    const reference = buildFocusReference(route.route_code || route.id);
    const payloadGrossWeight =
      environment === 'homologation' && totalGrossWeight <= 0 ? 5 : totalGrossWeight;

    const payload = {
      data_emissao: new Date().toISOString(),
      emitente: Number(settings.emit_type || 2),
      uf_inicio: loadingUf,
      uf_fim: distinctUnloadingUfs[0],
      municipios_carregamento: [
        {
          codigo: loadingCityCode,
          nome: loadingCityName,
        },
      ],
      municipios_descarregamento: Array.from(unloadingGroups.values()),
      cnpj_emitente: cleanDigits(emitter.cnpj),
      inscricao_estadual_emitente: cleanDigits(emitter.state_registration),
      nome_emitente: emitter.company_name,
      ...(emitter.trade_name ? { nome_fantasia_emitente: emitter.trade_name } : {}),
      logradouro_emitente: emitter.street,
      numero_emitente: emitter.number,
      ...(emitter.complement ? { complemento_emitente: emitter.complement } : {}),
      bairro_emitente: emitter.neighborhood,
      codigo_municipio_emitente: cleanDigits(emitter.city_code),
      municipio_emitente: emitter.city_name,
      ...(emitter.zip_code ? { cep_emitente: cleanDigits(emitter.zip_code) } : {}),
      uf_emitente: String(emitter.uf || '').trim().toUpperCase(),
      ...(emitter.phone ? { telefone_emitente: cleanDigits(emitter.phone) } : {}),
      ...(emitter.email ? { email_emitente: emitter.email } : {}),
      quantidade_total_nfe: documents.length,
      valor_total_carga: totalValue.toFixed(2),
      codigo_unidade_medida_peso_bruto: '01',
      peso_bruto: payloadGrossWeight.toFixed(4),
      veiculo_tracao: {
        placa: vehicle.plate,
      },
      modal_rodoviario: {
        placa_veiculo: vehicle.plate,
        ...(vehicle.renavam ? { renavam_veiculo: vehicle.renavam } : {}),
        tara_veiculo: Number(vehicle.tara_kg || 0),
        ...(vehicle.capacity_kg ? { capacidade_kg_veiculo: Number(vehicle.capacity_kg) } : {}),
        ...(vehicle.capacity_m3 ? { capacidade_m3_veiculo: Number(vehicle.capacity_m3) } : {}),
        condutores: [
          {
            nome: driver.name,
            cpf: cleanDigits(driver.cpf),
          },
        ],
        tipo_rodado_veiculo: rodadoType,
        tipo_carroceria_veiculo: bodyType,
        uf_licenciamento_veiculo: licensingUf,
      },
    };

    const focusResponse = await fetch(
      `${focusBaseUrl.replace(/\/$/, '')}/v2/mdfe?ref=${encodeURIComponent(reference)}`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Basic ${btoa(`${focusToken}:`)}`,
        },
        body: JSON.stringify(payload),
      }
    );

    const responseText = await focusResponse.text();
    const focusJson = safeJson(responseText);

    if (!focusResponse.ok) {
      return jsonResponse(
        {
          error: 'A Focus rejeitou a emissao do MDF-e.',
          status_code: focusResponse.status,
          focus_response: focusJson ?? responseText,
          payload,
        },
        focusResponse.status >= 400 && focusResponse.status < 600 ? focusResponse.status : 502
      );
    }

    const { data: manifest, error: manifestError } = await adminClient
      .from('mdfe_manifests')
      .insert({
        route_id: routeId,
        emitter_id: emitterId,
        vehicle_id: vehicleId,
        driver_id: driverId,
        status: 'processing',
        environment,
        operation_type: settings.operation_type || 'cargo_propria',
        loading_city_code: loadingCityCode,
        loading_city_name: loadingCityName,
        loading_uf: loadingUf,
        unloading_city_code: lastDocument.cityCode,
        unloading_city_name: lastDocument.cityName,
        unloading_uf: lastDocument.uf,
        total_documents: documents.length,
        total_value: totalValue,
        total_gross_weight: payloadGrossWeight,
        focus_reference: reference,
        payload_json: payload,
        response_json: focusJson ?? { raw: responseText },
        issued_at: null,
        error_message: null,
      })
      .select('id')
      .single();

    if (manifestError) throw manifestError;

    const manifestDocuments = documents.map((document) => ({
      manifest_id: manifest.id,
      order_id: document.orderId || null,
      order_id_erp: document.orderIdErp || null,
      nfe_key: document.nfeKey!,
      source_city_code: loadingCityCode,
      source_city_name: loadingCityName,
      source_uf: loadingUf,
      target_city_code: document.cityCode,
      target_city_name: document.cityName,
      target_uf: document.uf,
      total_value: document.totalValue,
      gross_weight: document.grossWeight,
      xml_snapshot: document.xml,
    }));

    const { error: documentsError } = await adminClient
      .from('mdfe_manifest_documents')
      .insert(manifestDocuments);

    if (documentsError) throw documentsError;

    return jsonResponse({
      ok: true,
      manifest_id: manifest.id,
      reference,
      focus_response: focusJson ?? responseText,
      warnings: documents.flatMap((document) =>
        document.warnings.map((warning) => `Pedido ${document.orderIdErp || '-'}: ${warning}`)
      ),
    });
  } catch (error) {
    console.error(error);
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : 'Erro interno ao emitir MDF-e.',
      },
      500
    );
  }
});

function parseNfeDocument({
  orderId,
  orderIdErp,
  customerName,
  xml,
}: {
  orderId: string;
  orderIdErp: string;
  customerName: string;
  xml: string;
}): ParsedDocument {
  if (!xml || !xml.includes('<')) {
    return {
      orderId,
      orderIdErp,
      customerName,
      xml,
      nfeKey: null,
      totalValue: 0,
      grossWeight: 0,
      cityCode: null,
      cityName: null,
      uf: null,
      blockingIssues: ['XML nao encontrado no pedido.'],
      warnings: [],
    };
  }

  try {
    const nfeKey = getXmlValue(xml, 'chNFe') || null;
    const totalValue = parseDecimal(getXmlValue(xml, 'vNF'));
    const cityCode = getLastXmlValue(xml, 'cMun') || null;
    const cityName = getLastXmlValue(xml, 'xMun') || null;
    const uf = getLastXmlValue(xml, 'UF') || null;
    const grossWeight = resolveGrossWeightFromXml(xml);

    const blockingIssues: string[] = [];
    const warnings: string[] = [];

    if (!nfeKey) blockingIssues.push('Chave NF-e nao encontrada no XML.');
    if (!cityName || !uf || !cityCode) blockingIssues.push('Cidade de descarregamento nao encontrada no XML.');
    if (grossWeight <= 0) warnings.push('Peso bruto nao encontrado no XML. A emissao seguira sem bloquear.');

    return {
      orderId,
      orderIdErp,
      customerName,
      xml,
      nfeKey,
      totalValue,
      grossWeight,
      cityCode,
      cityName,
      uf,
      blockingIssues,
      warnings,
    };
  } catch {
    return {
      orderId,
      orderIdErp,
      customerName,
      xml,
      nfeKey: null,
      totalValue: 0,
      grossWeight: 0,
      cityCode: null,
      cityName: null,
      uf: null,
      blockingIssues: ['Falha ao interpretar o XML da NF-e.'],
      warnings: [],
    };
  }
}

function resolveGrossWeightFromXml(xml: string) {
  const allGrossWeights = getAllXmlValues(xml, 'pesoB')
    .map((value) => parseDecimal(value))
    .filter((value) => value > 0);

  const totalFromVolumes = allGrossWeights.reduce((acc, value) => acc + value, 0);
  if (totalFromVolumes > 0) return totalFromVolumes;

  return parseDecimal(getXmlValue(xml, 'pesoB')) || parseDecimal(getXmlValue(xml, 'pesoL'));
}

function getXmlValue(xml: string, tagName: string) {
  return getAllXmlValues(xml, tagName)[0] || '';
}

function getLastXmlValue(xml: string, tagName: string) {
  const values = getAllXmlValues(xml, tagName);
  return values[values.length - 1] || '';
}

function getAllXmlValues(xml: string, tagName: string) {
  const pattern = new RegExp(`<([\\w.:_-]+:)?${tagName}>([\\s\\S]*?)<\\/([\\w.:_-]+:)?${tagName}>`, 'g');
  const values: string[] = [];

  for (const match of xml.matchAll(pattern)) {
    values.push(String(match[2] || '').trim());
  }

  return values;
}

function parseDecimal(value: string) {
  const parsed = Number(String(value || '0').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanDigits(value: string | null | undefined) {
  return String(value || '').replace(/\D/g, '');
}

function buildFocusReference(routeCode: string) {
  const base = String(routeCode || 'mdfe').replace(/[^a-zA-Z0-9_-]/g, '-');
  return `${base}-${Date.now()}`;
}

function safeJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function reconcileManifestStatus({
  manifestId,
  reference,
  focusBaseUrl,
  focusToken,
}: {
  manifestId: string;
  reference: string;
  focusBaseUrl: string;
  focusToken: string;
}) {
  try {
    const response = await fetch(
      `${focusBaseUrl.replace(/\/$/, '')}/v2/mdfe/${encodeURIComponent(reference)}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Basic ${btoa(`${focusToken}:`)}`,
        },
      }
    );

    const responseText = await response.text();
    const focusJson = safeJson(responseText) ?? { raw: responseText };
    const mappedStatus = mapFocusStatusToLocal(focusJson);

    if (mappedStatus) {
      await adminClient
        .from('mdfe_manifests')
        .update({
          status: mappedStatus,
          response_json: focusJson,
          error_message: mappedStatus === 'error' ? resolveFocusMessage(focusJson) : null,
        })
        .eq('id', manifestId);
    }

    return mappedStatus;
  } catch (error) {
    console.warn('Falha ao reconciliar status do MDF-e na Focus:', error);
    return null;
  }
}

function mapFocusStatusToLocal(payload: any) {
  const status = normalizeStatus(
    payload?.status ||
      payload?.situacao ||
      payload?.status_sefaz ||
      payload?.descricao_status ||
      payload?.codigo_status
  );

  if (!status) return null;
  if (status.includes('autoriz')) return 'issued';
  if (status.includes('encerr')) return 'closed';
  if (status.includes('cancel')) return 'cancelled';
  if (
    status.includes('erro') ||
    status.includes('rejei') ||
    status.includes('deneg') ||
    status.includes('nao autoriz')
  ) {
    return 'error';
  }
  if (status.includes('process')) return 'processing';
  return null;
}

function resolveFocusMessage(payload: any) {
  return (
    payload?.mensagem ||
    payload?.message ||
    payload?.descricao ||
    payload?.status_sefaz ||
    payload?.codigo_status ||
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}
