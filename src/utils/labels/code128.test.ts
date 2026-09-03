import { describe, it, expect } from 'vitest';
// `bwip-js/node`: o caminho explícito de Node, pra deixar claro que isto nunca
// roda no navegador (e porque o resolvedor do app não enxerga o pacote raiz).
import bwipjs from 'bwip-js/node';
import {
  CODE128_PATTERNS,
  CODE128_START_B,
  CODE128_STOP,
  code128Bars,
  code128BValues,
  code128ModuleCount,
  code128Widths,
  sanitizeCode128,
} from './code128';

/**
 * A bwip-js NÃO entra no app (infla o bundle e quebra o build). Ela existe só
 * aqui, no teste que roda no Node, pra provar que a nossa tabela de padrões é
 * igual à dela.
 *
 * Comparação é padrão por padrão, não desenho inteiro: a bwip-js comprime
 * dígitos usando o subset C, então o código completo dela pode ser mais curto
 * que o nosso (que é sempre subset B). Os padrões de cada símbolo, porém, são
 * os mesmos.
 */

/** Fatia o `sbs` da bwip-js em símbolos de 6 elementos (a parada tem 7). */
const bwipSymbols = (text: string): string[] => {
  const sbs: number[] = (bwipjs as any).raw({ bcid: 'code128', text })[0].sbs;
  const symbols: string[] = [];
  const body = sbs.length - 7; // tudo menos a parada, que tem 7 elementos
  for (let i = 0; i < body; i += 6) {
    symbols.push(sbs.slice(i, i + 6).join(''));
  }
  symbols.push(sbs.slice(body).join(''));
  return symbols;
};

describe('tabela do Code 128 conferida contra a bwip-js', () => {
  it('tem 107 padrões, com 6 elementos cada (a parada tem 7)', () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    CODE128_PATTERNS.slice(0, 106).forEach((p) => expect(p).toHaveLength(6));
    expect(CODE128_PATTERNS[CODE128_STOP]).toHaveLength(7);
  });

  it('bate padrão por padrão em todo o subset B (ASCII 32 a 126)', () => {
    // Um caractere por vez: assim a bwip-js não tem par de dígitos pra comprimir
    // em subset C e o símbolo dela é exatamente o nosso.
    for (let code = 32; code <= 126; code++) {
      const ch = String.fromCharCode(code);
      const symbols = bwipSymbols(ch);
      // [ Start B, caractere, dígito verificador, parada ]
      expect(symbols[0]).toBe(CODE128_PATTERNS[CODE128_START_B]);
      expect(symbols[1]).toBe(CODE128_PATTERNS[code - 32]);
      expect(symbols[3]).toBe(CODE128_PATTERNS[CODE128_STOP]);
    }
  });

  it('reproduz o código inteiro da bwip-js quando não há dígitos pra comprimir', () => {
    // Sem par de dígitos seguidos, a bwip-js também fica em subset B do começo
    // ao fim — aí dá pra comparar o desenho todo, inclusive o verificador.
    ['ROUPEIRO/CAIRO-A', 'a1b2c3-d4', 'VOL 1/6'].forEach((text) => {
      expect(code128Widths(text).join('')).toBe(bwipSymbols(text).join(''));
    });
  });

  it('calcula o dígito verificador do jeito certo (módulo 103)', () => {
    // 'AB-c/1' → Start B(104) + 33 + 34 + 13 + 67 + 15 + 17, pesos 1..6.
    const esperado = (104 + 33 * 1 + 34 * 2 + 13 * 3 + 67 * 4 + 15 * 5 + 17 * 6) % 103;
    const values = code128BValues('AB-c/1');
    expect(values[values.length - 2]).toBe(esperado);
  });
});

describe('desenho do código de barras', () => {
  it('a etiqueta do ERP vira um código de tamanho previsível', () => {
    // 10 caracteres = Start + 10 + verificador = 12 símbolos de 11 módulos,
    // mais os 13 da parada.
    expect(code128ModuleCount('1/6-2852-1')).toBe(12 * 11 + 13);
  });

  it('só devolve as barras pretas, sem sobrepor e dentro do total de módulos', () => {
    const texto = '1/6-2852-1';
    const bars = code128Bars(texto);
    const total = code128ModuleCount(texto);
    expect(bars.length).toBeGreaterThan(0);
    bars.forEach((b, i) => {
      expect(b.width).toBeGreaterThan(0);
      expect(b.start + b.width).toBeLessThanOrEqual(total);
      if (i > 0) expect(b.start).toBeGreaterThan(bars[i - 1].start + bars[i - 1].width - 1);
    });
    // Code 128 sempre termina em barra (a parada tem barra final).
    expect(bars[bars.length - 1].start + bars[bars.length - 1].width).toBe(total);
  });

  it('troca caractere fora do subset B em vez de gerar código inválido', () => {
    expect(sanitizeCode128('CAMA JOÃO')).toBe('CAMA JO-O');
    expect(() => code128Widths('CAMA JOÃO')).not.toThrow();
  });
});
