import { PDFDocument } from 'pdf-lib';
import { supabase } from '../../supabase/client';

// Nota fiscal da retirada.
//
// Extraido da tela de admin (RouteCreation) para a tela do gerente poder usar o
// MESMO codigo: o produto sai da loja com o documento, tanto faz por qual tela a
// retirada foi registrada. Antes so o admin emitia, e a retirada feita pelo
// gerente saia sem nota.
//
// A DANFE ja vem pronta em orders.danfe_base64 (gerada na importacao). Aqui so
// buscamos e juntamos num PDF unico.

/** Busca as DANFEs ja geradas dos pedidos informados. */
export async function fetchPickupDanfes(orderIds: string[]): Promise<string[]> {
  const ids = Array.from(new Set(orderIds.map((id) => String(id || '').trim()).filter(Boolean)));
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from('orders')
    .select('id, danfe_base64')
    .in('id', ids);

  if (error) throw error;

  return (data || [])
    .map((row: any) => String(row?.danfe_base64 || ''))
    .filter((base64) => base64.startsWith('JVBER'));
}

/** Junta as DANFEs num PDF unico. Lanca se nenhum pedido tiver nota. */
export async function buildPickupDanfePdf(orderIds: string[]): Promise<Uint8Array> {
  const danfes = await fetchPickupDanfes(orderIds);
  if (danfes.length === 0) {
    throw new Error('Nenhuma nota fiscal encontrada para os pedidos selecionados.');
  }

  const merged = await PDFDocument.create();
  for (const base64 of danfes) {
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
): Promise<{ pdf: Uint8Array; semNota: boolean }> {
  let danfePdf: Uint8Array | null = null;
  let semNota = false;

  try {
    danfePdf = await buildPickupDanfePdf(orderIds);
  } catch {
    semNota = true;
  }

  if (!danfePdf) return { pdf: receiptPdf, semNota };

  const merged = await PDFDocument.create();
  for (const bytes of [receiptPdf, danfePdf]) {
    const source = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }

  return { pdf: await merged.save(), semNota };
}
