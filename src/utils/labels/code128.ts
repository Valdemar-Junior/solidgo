/**
 * Code 128 (subset B) — a mesma simbologia da etiqueta que o ERP imprime hoje.
 *
 * Desenhamos o código de barras direto no PDF, como retângulos, em vez de usar
 * uma biblioteca: fica vetorial (imprime nítido em qualquer resolução da
 * térmica) e não carrega megabytes de JavaScript no app.
 *
 * A tabela abaixo é conferida contra a bwip-js em `code128.test.ts`.
 */

/** Larguras (em módulos) de cada padrão: barra, espaço, barra, espaço... */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
];

const START_B = 104;
const STOP = 106;

/** Só ASCII imprimível cabe no subset B. */
export const isCode128B = (text: string) =>
  [...String(text || '')].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126);

/**
 * Converte o texto na sequência de larguras barra/espaço (começando por barra).
 * Ex.: [2,1,1,2,1,4, ...] onde cada número é quantos "módulos" o traço ocupa.
 */
export const code128Widths = (text: string): number[] => {
  const chars = [...String(text || '')];
  if (!isCode128B(chars.join(''))) {
    throw new Error('Code 128B aceita apenas caracteres ASCII imprimíveis');
  }

  const values = chars.map((c) => c.charCodeAt(0) - 32);

  // Dígito verificador: start + soma de (posição * valor), módulo 103.
  let checksum = START_B;
  values.forEach((v, i) => { checksum += v * (i + 1); });
  checksum %= 103;

  const sequence = [START_B, ...values, checksum, STOP];
  const widths: number[] = [];
  sequence.forEach((code) => {
    [...PATTERNS[code]].forEach((w) => widths.push(Number(w)));
  });
  return widths;
};

/** Quantos módulos o código inteiro ocupa (sem margem de silêncio). */
export const code128ModuleCount = (text: string) =>
  code128Widths(text).reduce((acc, w) => acc + w, 0);
