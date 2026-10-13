import { PDFDocument } from 'pdf-lib';
import { supabase } from '../../supabase/client';
import { generateDanfeBase64 } from '../danfe/generateDanfe';

// Nota fiscal da retirada.
//
// Extraido da tela de admin (RouteCreation) para a tela do gerente poder usar o
// MESMO codigo: o produto sai da loja com o documento, tanto faz por qual tela a
// retirada foi registrada. Antes so o admin emitia, e a retirada feita pelo
// gerente saia sem nota.
//
// A DANFE normalmente ja vem pronta em orders.danfe_base64 (gerada em segundo
// plano na importacao). Essa geracao falha de vez em quando (DanfeHub lento, aba
// fechada no meio) e, diferente da rota de entrega, a retirada nao tinha botao
// para gerar as que faltam. Agora, se faltar, geramos aqui a partir do XML da
// venda e guardamos no pedido.

/** XML da NF-e de venda do pedido (mesma regra do botao da rota de entrega). */
function pickSaleXml(order: any): string {
  const direct = String(order?.xml_documento || '').trim();
  if (direct.includes('<')) return direct;

  const arr = order?.raw_json?.xmls_documentos || order?.raw_json?.xmls || [];
  const first = Array.isArray(arr) ? arr[0] : null;
  const fallback = first ? (typeof first === 'string' ? first : String(first?.xml || '')) : '';
  return fallback.includes('<') ? fallback.trim() : '';
}

export type PickupDanfeResult = {
  danfes: string[];
  /** Numeros dos pedidos sem XML da venda — o ERP nao mandou, nao ha como gerar. */
  semXml: string[];
  /** Numeros dos pedidos com XML, mas o servico de DANFE nao respondeu. */
  falhaGeracao: string[];
};

/**
 * Busca as DANFEs dos pedidos informados. As que faltarem sao geradas na hora a
 * partir do XML e salvas no pedido (se o usuario nao puder salvar, a nota sai
 * impressa do mesmo jeito; so nao fica guardada).
 */
export async function fetchPickupDanfes(orderIds: string[]): Promise<PickupDanfeResult> {
  const ids = Array.from(new Set(orderIds.map((id) => String(id || '').trim()).filter(Boolean)));
  const result: PickupDanfeResult = { danfes: [], semXml: [], falhaGeracao: [] };
  if (ids.length === 0) return result;

  const { data, error } = await supabase
    .from('orders')
    .select('id, order_id_erp, danfe_base64')
    .in('id', ids);

  if (error) throw error;

  const rows = data || [];
  const missing = rows.filter((row: any) => !String(row?.danfe_base64 || '').startsWith('JVBER'));

  // So busca o XML (campo pesado) de quem esta sem nota.
  const xmlById = new Map<string, any>();
  if (missing.length > 0) {
    const { data: xmlRows, error: xmlError } = await supabase
      .from('orders')
      .select('id, xml_documento, raw_json')
      .in('id', missing.map((row: any) => row.id));
    if (xmlError) throw xmlError;
    (xmlRows || []).forEach((row: any) => xmlById.set(String(row.id), row));
  }

  for (const row of rows as any[]) {
    const stored = String(row?.danfe_base64 || '');
    if (stored.startsWith('JVBER')) {
      result.danfes.push(stored);
      continue;
    }

    const numero = String(row?.order_id_erp || row?.id || '');
    const xml = pickSaleXml(xmlById.get(String(row.id)));
    if (!xml) {
      result.semXml.push(numero);
      continue;
    }

    const generated = await generateDanfeBase64(xml);
    if (!generated.startsWith('JVBER')) {
      result.falhaGeracao.push(numero);
      continue;
    }

    result.danfes.push(generated);
    const { error: saveError } = await supabase
      .from('orders')
      .update({ danfe_base64: generated, danfe_gerada_em: new Date().toISOString() })
      .eq('id', row.id);
    if (saveError) console.warn(`[Retirada] DANFE do pedido ${numero} gerada, mas nao foi salva:`, saveError);
  }

  return result;
}

/** Mensagem clara de por que nao saiu nota nenhuma. */
export function describeMissingDanfe(result: PickupDanfeResult): string {
  if (result.semXml.length > 0 && result.falhaGeracao.length === 0) {
    return `O ERP não enviou o XML da nota fiscal (pedido ${result.semXml.join(', ')}). Reimporte o pedido ou emita a nota pelo ERP.`;
  }
  if (result.falhaGeracao.length > 0) {
    return 'Não foi possível gerar a nota fiscal agora (serviço de notas não respondeu). Tente de novo em instantes.';
  }
  return 'Nenhuma nota fiscal encontrada para os pedidos selecionados.';
}

/** Junta as DANFEs num PDF unico. Lanca (com o motivo) se nenhum pedido tiver nota. */
export async function buildPickupDanfePdf(orderIds: string[]): Promise<Uint8Array> {
  const result = await fetchPickupDanfes(orderIds);
  if (result.danfes.length === 0) {
    throw new Error(describeMissingDanfe(result));
  }

  const merged = await PDFDocument.create();
  for (const base64 of result.danfes) {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const source = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }

  return merged.save();
}

/**
 * Junta o comprovante de retirada com a nota fiscal num PDF so, para sair tudo
 * numa impressao. Se a nota nao existir, devolve o comprovante sozinho e avisa
 * pelo retorno — retirada sem nota ainda e melhor que retirada sem documento
 * nenhum, mas quem chamou precisa saber para alertar o operador.
 */
export async function mergeReceiptWithDanfe(
  receiptPdf: Uint8Array,
  orderIds: string[],
): Promise<{ pdf: Uint8Array; semNota: boolean; motivo?: string }> {
  let danfePdf: Uint8Array | null = null;
  let semNota = false;
  let motivo: string | undefined;

  try {
    danfePdf = await buildPickupDanfePdf(orderIds);
  } catch (e: any) {
    semNota = true;
    motivo = e?.message;
  }

  if (!danfePdf) return { pdf: receiptPdf, semNota, motivo };

  const merged = await PDFDocument.create();
  for (const bytes of [receiptPdf, danfePdf]) {
    const source = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }

  return { pdf: await merged.save(), semNota };
}
