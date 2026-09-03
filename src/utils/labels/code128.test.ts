import { describe, it, expect } from 'vitest';
import bwipjs from 'bwip-js/node';
import { code128Widths, code128ModuleCount, isCode128B } from './code128';

/**
 * Larguras barra/espaço que a bwip-js (referência) produz.
 *
 * Ela comprime sequências de dígitos usando o subset C, então o desenho dela
 * para um texto inteiro não é igual ao nosso (que usa só o subset B). Os dois
 * são lidos como o MESMO texto pelo leitor — o que precisa bater é a tabela de
 * padrões, e é isso que os testes abaixo conferem, símbolo por símbolo.
 */
const referenceWidths = (text: string): number[] => {
  const raw = bwipjs.raw('code128', text) as any[];
  return (raw[0].sbs as number[]).map(Number);
};

const START_B = 104;
const STOP = 106;

describe('tabela de padrões do Code 128', () => {
  // Valores 0..94 do subset B = ASCII 32..126, um caractere por vez.
  const valores = Array.from({ length: 95 }, (_, v) => v);

  it.each(valores)('padrão do valor %i bate com a referência', (valor) => {
    const char = String.fromCharCode(valor + 32);
    const ref = referenceWidths(char);
    const meu = code128Widths(char);

    // start(6) + caractere(6) + verificador(6) + stop(7) = 25 larguras
    expect(ref).toHaveLength(25);
    expect(meu).toEqual(ref);
  });
});

describe('montagem do código', () => {
  it('usa start B, calcula o verificador e fecha com o stop', () => {
    const widths = code128Widths('A');
    const ref = referenceWidths('A');
    // Start e stop vêm da referência; o verificador é o miolo.
    expect(widths.slice(0, 6)).toEqual(ref.slice(0, 6));      // start B
    expect(widths.slice(18)).toEqual(ref.slice(18));          // stop
    expect(START_B).toBe(104);
    expect(STOP).toBe(106);
  });

  it.each([
    '1/1-1621-3-84',
    '1/4-1347-1',
    '10/12-788-4',
    '145319*1/4-1347-1',
  ])('conta 11 módulos por caractere + start + verificador + 13 do stop: %s', (texto) => {
    expect(code128ModuleCount(texto)).toBe(11 * (texto.length + 2) + 13);
  });

  it('recusa caractere fora do ASCII imprimível', () => {
    expect(isCode128B('ROUPEIRO Ç')).toBe(false);
    expect(() => code128Widths('ROUPEIRO Ç')).toThrow();
  });
});
