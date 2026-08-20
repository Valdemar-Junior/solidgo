import { describe, it, expect, vi } from 'vitest';
import { chunkArray, fetchInChunks, fetchAllPages } from './batch';

describe('chunkArray — divide listas grandes em lotes (URL curta)', () => {
  it('divide 250 ids em lotes de 100', () => {
    const chunks = chunkArray(Array.from({ length: 250 }, (_, i) => i), 100);
    expect(chunks.map((c) => c.length)).toEqual([100, 100, 50]);
  });

  it('lista vazia vira zero lotes (nenhuma consulta é feita)', () => {
    expect(chunkArray([], 100)).toEqual([]);
  });

  it('lista menor que o lote vira um lote só', () => {
    expect(chunkArray([1, 2, 3], 100)).toEqual([[1, 2, 3]]);
  });
});

describe('fetchInChunks — o bug da fila (2026-07-15) não pode voltar', () => {
  it('junta os resultados de todos os lotes (nenhum registro se perde)', async () => {
    const ids = Array.from({ length: 230 }, (_, i) => `id-${i}`);
    const run = vi.fn(async (chunk: string[]) => ({
      data: chunk.map((id) => ({ id })),
      error: null,
    }));

    const rows = await fetchInChunks(ids, run, 100);

    expect(run).toHaveBeenCalledTimes(3); // 100 + 100 + 30
    expect(rows).toHaveLength(230);
    expect(rows[0]).toEqual({ id: 'id-0' });
    expect(rows[229]).toEqual({ id: 'id-229' });
  });

  it('NUNCA falha em silêncio: erro de um lote é lançado', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => i);
    const run = vi.fn(async (chunk: number[]) =>
      chunk[0] === 100
        ? { data: null, error: new Error('400 Bad Request') }
        : { data: chunk.map((id) => ({ id })), error: null },
    );

    await expect(fetchInChunks(ids, run, 100)).rejects.toThrow('400 Bad Request');
  });
});

describe('fetchAllPages — o corte silencioso de 1000 linhas não pode voltar', () => {
  it('busca todas as páginas até a última (fila com 2350 pedidos)', async () => {
    const TOTAL = 2350;
    const all = Array.from({ length: TOTAL }, (_, i) => ({ n: i }));
    const run = vi.fn(async (from: number, to: number) => ({
      data: all.slice(from, to + 1),
      error: null,
    }));

    const rows = await fetchAllPages(run, 1000);

    expect(run).toHaveBeenCalledTimes(3); // 1000 + 1000 + 350
    expect(rows).toHaveLength(TOTAL);
    expect(rows[TOTAL - 1]).toEqual({ n: TOTAL - 1 });
  });

  it('resultado exatamente do tamanho da página faz UMA consulta extra e para', async () => {
    const all = Array.from({ length: 1000 }, (_, i) => ({ n: i }));
    const run = vi.fn(async (from: number, to: number) => ({
      data: all.slice(from, to + 1),
      error: null,
    }));

    const rows = await fetchAllPages(run, 1000);

    expect(rows).toHaveLength(1000);
    expect(run).toHaveBeenCalledTimes(2); // segunda página vem vazia e encerra
  });

  it('erro em qualquer página é lançado (nunca corta em silêncio)', async () => {
    const run = vi.fn(async (from: number) =>
      from === 0
        ? { data: Array.from({ length: 1000 }, (_, i) => ({ n: i })), error: null }
        : { data: null, error: new Error('falhou na página 2') },
    );

    await expect(fetchAllPages(run, 1000)).rejects.toThrow('falhou na página 2');
  });
});
