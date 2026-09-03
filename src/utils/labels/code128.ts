/**
 * Code 128 (subset B) desenhado à mão.
 *
 * Por que não usar uma biblioteca: a `bwip-js` carrega um interpretador inteiro
 * e leva o bundle de ~2 MB para ~5,35 MB, estourando o limite do service worker
 * e quebrando o `npm run build`. Aqui só existe a tabela de padrões — a mesma
 * tabela da bwip-js, conferida padrão por padrão em `code128.test.ts` (esse
 * teste roda só no Node, a bwip-js nunca entra no app).
 *
 * O desenho sai vetorial no PDF (retângulos), o que fica mais nítido na térmica
 * do que uma imagem redimensionada.
 */

/**
 * Os 107 padrões do Code 128: cada um são as larguras (em módulos) de
 * barra/espaço/barra/espaço/barra/espaço. O último (valor 106, a parada) tem
 * 7 elementos porque leva uma barra extra no fim.
 */
export const CODE128_PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

/** Valor do caractere Start B na tabela. */
export const CODE128_START_B = 104;
/** Valor da parada (Stop) na tabela. */
export const CODE128_STOP = 106;

/** Só ASCII imprimível (32 a 126) entra no subset B. */
export const isCode128BSafe = (text: string) =>
  [...String(text)].every((ch) => {
    const c = ch.charCodeAt(0);
    return c >= 32 && c <= 126;
  });

/** Troca o que não couber no subset B por '-', pra nunca gerar código inválido. */
export const sanitizeCode128 = (text: string) =>
  [...String(text ?? '')]
    .map((ch) => {
      const c = ch.charCodeAt(0);
      return c >= 32 && c <= 126 ? ch : '-';
    })
    .join('');

/**
 * Os valores da tabela para um texto: Start B, os caracteres, o dígito
 * verificador (módulo 103) e a parada.
 */
export const code128BValues = (text: string): number[] => {
  const clean = sanitizeCode128(text);
  const values = [CODE128_START_B];
  let checksum = CODE128_START_B;

  [...clean].forEach((ch, i) => {
    const value = ch.charCodeAt(0) - 32;
    values.push(value);
    checksum += value * (i + 1);
  });

  values.push(checksum % 103);
  values.push(CODE128_STOP);
  return values;
};

/**
 * Larguras em módulos, alternando barra/espaço e SEMPRE começando por barra —
 * é o mesmo formato `sbs` que a bwip-js devolve, o que deixa o teste comparar
 * os dois lado a lado.
 */
export const code128Widths = (text: string): number[] =>
  code128BValues(text)
    .flatMap((v) => [...CODE128_PATTERNS[v]].map(Number));

/** Total de módulos do código (sem as margens brancas laterais). */
export const code128ModuleCount = (text: string): number =>
  code128Widths(text).reduce((acc, w) => acc + w, 0);

/**
 * Só as barras pretas, já como retângulos: posição inicial e largura em
 * módulos. É o que o gerador de PDF precisa desenhar.
 */
export const code128Bars = (text: string): { start: number; width: number }[] => {
  const bars: { start: number; width: number }[] = [];
  let cursor = 0;
  code128Widths(text).forEach((width, i) => {
    if (i % 2 === 0) bars.push({ start: cursor, width }); // índice par = barra
    cursor += width;
  });
  return bars;
};
