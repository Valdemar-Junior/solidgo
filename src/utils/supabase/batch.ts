// Helpers pra consultas do Supabase que crescem com o volume de dados.
//
// Por que existem (bug real de 2026-07-15): o filtro `.in()` viaja DENTRO da
// URL. Com 600+ ids a URL estoura o limite do servidor, que responde 400 — e
// como vários pontos engoliam o erro, dados sumiam da tela em silêncio
// (ex.: todo pedido devolvido desaparecia da fila de roteirização).
// Além disso, o PostgREST corta QUALQUER consulta em 1000 linhas por padrão,
// sem erro — listas grandes (fila, montagens) perdem registros ao crescer.
//
// Regra do projeto: toda consulta cuja lista de ids OU cujo resultado cresce
// com a operação (pedidos, saldos, montagens, relatórios) usa estes helpers.

/** Divide `values` em lotes de `size` (default 100 — mantém a URL curta). */
export function chunkArray<T>(values: T[], size = 100): T[][] {
  const out: T[][] = [];
  const safe = Math.max(1, Math.floor(size));
  for (let i = 0; i < values.length; i += safe) {
    out.push(values.slice(i, i + safe));
  }
  return out;
}

type QueryResult<Row> = { data: Row[] | null; error: unknown };

/**
 * Roda `run` uma vez por lote de ids e junta os resultados.
 * Lança o erro do primeiro lote que falhar (nunca falhe em silêncio:
 * quem chama decide se avisa o usuário).
 */
export async function fetchInChunks<Id, Row>(
  ids: Id[],
  run: (chunk: Id[]) => PromiseLike<QueryResult<Row>>,
  chunkSize = 100,
): Promise<Row[]> {
  const out: Row[] = [];
  for (const chunk of chunkArray(ids, chunkSize)) {
    const { data, error } = await run(chunk);
    if (error) throw error;
    if (data) out.push(...data);
  }
  return out;
}

/**
 * Busca TODAS as páginas de uma consulta (o PostgREST corta em 1000 linhas
 * por padrão, silenciosamente). `run` recebe o intervalo e deve aplicar
 * `.range(from, to)` na consulta.
 * Para quando a página vem menor que `pageSize` (última página).
 */
export async function fetchAllPages<Row>(
  run: (from: number, to: number) => PromiseLike<QueryResult<Row>>,
  pageSize = 1000,
): Promise<Row[]> {
  const out: Row[] = [];
  const size = Math.max(1, Math.floor(pageSize));
  for (let from = 0; ; from += size) {
    const { data, error } = await run(from, from + size - 1);
    if (error) throw error;
    const rows = data || [];
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}
