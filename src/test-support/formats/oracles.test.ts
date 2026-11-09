import { describe, expect, it } from 'vitest';
import { decodeCp437 } from '../../core/fat12';
import { checkResultInvariants, digitSkeleton } from './invariants';
import {
  dbfHeaderOracle,
  detectFullOracle,
  detectOracle,
  encodeCp437,
  expectedCell,
  isTextSampleOracle,
  plainTextOracle,
  findMarkdownDecomposition,
  isRealDate,
  lineMarkersBalanced,
  lineMatchesStyles,
  markdownLineDecompositions,
  pcxHeaderOracle,
  pngSizeFromFirstPrinciples,
  referenceAdler32,
  referenceRle,
} from './oracles';

const bytesOf = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

describe('numeric oracles', () => {
  it('Adler-32 reference matches the Wikipedia example', () => {
    expect(referenceAdler32(bytesOf('Wikipedia'))).toBe(0x11e60398);
    expect(referenceAdler32(new Uint8Array(0))).toBe(1);
  });

  it('PNG size from first principles', () => {
    expect(pngSizeFromFirstPrinciples(1024, 4096)).toBe(16782660);
    expect(pngSizeFromFirstPrinciples(1, 1)).toBe(8 + 25 + (12 + 2 + 5 + 5 + 4) + 12);
  });

  it('RLE reference: literals, runs, truncation, ignored tail', () => {
    expect(Array.from(referenceRle(Uint8Array.of(1, 0xc3, 9, 2), 5).data)).toEqual([1, 9, 9, 9, 2]);
    const cut = referenceRle(Uint8Array.of(1, 0xc3), 3);
    expect(cut.truncated).toBe(true);
    expect(cut.filled).toBe(1);
    expect(Array.from(cut.data)).toEqual([1, 0, 0]);
    const extra = referenceRle(Uint8Array.of(0xff, 7), 2);
    expect(extra.truncated).toBe(false);
    expect(Array.from(extra.data)).toEqual([7, 7]);
  });
});

describe('cell oracles', () => {
  it('calendar', () => {
    expect(isRealDate(2000, 2, 29)).toBe(true);
    expect(isRealDate(1900, 2, 29)).toBe(false);
    expect(isRealDate(0, 1, 1)).toBe(false);
    expect(isRealDate(9999, 12, 31)).toBe(true);
  });

  it('N, D, L and C cells', () => {
    expect(expectedCell('N', bytesOf('  -12.50 '))).toEqual({ text: '-12.50', invalid: false });
    expect(expectedCell('N', bytesOf('1.'))).toEqual({ text: '', invalid: true });
    expect(expectedCell('D', bytesOf('20240229')).text).toBe('2024-02-29');
    expect(expectedCell('D', bytesOf('        '))).toEqual({ text: '', invalid: false });
    expect(expectedCell('D', bytesOf('20230229')).invalid).toBe(true);
    expect(expectedCell('L', bytesOf('y')).text).toBe('TRUE');
    expect(expectedCell('L', bytesOf('x')).invalid).toBe(true);
    expect(expectedCell('C', Uint8Array.of(0x41, 0x01, 0x42, 0x20, 0x00)).text).toBe('A B');
  });
});

describe('header oracles', () => {
  it('detects PCX, dBase and WordStar content', () => {
    expect(detectOracle(Uint8Array.of(0x0a, 5, 1, 8))).toBe('pcx');
    const dbf = new Uint8Array(100);
    dbf[0] = 3;
    dbf[8] = 65;
    dbf[10] = 2;
    expect(detectOracle(dbf)).toBe('dbase');
    expect(detectOracle(Uint8Array.of(0x41, 0x8d, 0x0a))).toBe('wordstar');
    expect(detectOracle(bytesOf('.PA\r\nhi'))).toBe('wordstar');
    expect(detectOracle(new Uint8Array(0))).toBe('unknown');
  });

  it('detectOracle: MZ veto, NUL and odd-byte budgets, traits', () => {
    expect(detectOracle(Uint8Array.of(0x4d, 0x5a, 0x41, 0x8d, 0x0a))).toBe('unknown');
    expect(detectOracle(Uint8Array.of(0x5a, 0x4d, 0x41, 0x8d, 0x0a))).toBe('unknown');
    expect(detectOracle(Uint8Array.of(0x41, 0x4d, 0x5a, 0x8d, 0x0a))).toBe('wordstar');
    // 64 bytes: one NUL is within n >> 6, two are not.
    const nul = (count: number) => {
      const b = new Uint8Array(64).fill(0x41);
      b[0] = 0x2e;
      b[1] = 0x50;
      b[2] = 0x41;
      for (let i = 0; i < count; i++) b[10 + i] = 0;
      return b;
    };
    expect(detectOracle(nul(1))).toBe('wordstar');
    expect(detectOracle(nul(2))).toBe('unknown');
    // 16 bytes: one odd byte is within n >> 4, two are not; 0xA0 is a space (low 7 bits 0x20).
    const odd = (count: number) => {
      const b = new Uint8Array(16).fill(0x41);
      b[0] = 0x41;
      b[1] = 0x8d;
      b[2] = 0x0a;
      for (let i = 0; i < count; i++) b[8 + i] = 0x01;
      return b;
    };
    expect(detectOracle(odd(1))).toBe('wordstar');
    expect(detectOracle(odd(2))).toBe('unknown');
    const soft = Uint8Array.of(0x41, 0x41, 0x1f, 0x8d, 0x0a, 0xa0, 0x41, 0x41);
    expect(detectOracle(soft)).toBe('wordstar');
    expect(detectOracle(Uint8Array.of(0x41, 0x42, 0x43))).toBe('unknown');
  });

  it('dBase header verdicts', () => {
    expect(dbfHeaderOracle(new Uint8Array(10))).toEqual({ accepted: false, kind: 'invalid', condition: 2 });
    const h = new Uint8Array(65);
    h[0] = 3;
    h[8] = 65;
    h[10] = 2;
    h[32 + 16] = 1;
    h[64] = 0x0d;
    expect(dbfHeaderOracle(h)).toMatchObject({ accepted: true, fieldCount: 1 });
    h[0] = 4;
    expect(dbfHeaderOracle(h)).toEqual({ accepted: false, kind: 'version', version: 4 });
  });

  it('PCX header verdicts', () => {
    expect(pcxHeaderOracle(new Uint8Array(5))).toMatchObject({ accepted: false, kind: 'short' });
    const h = new Uint8Array(128);
    h[0] = 0x0a;
    h[1] = 5;
    h[2] = 1;
    h[3] = 8;
    h[8] = 3; // xmax 3 -> width 4
    h[10] = 1; // ymax 1 -> height 2
    h[65] = 1;
    h[66] = 4;
    expect(pcxHeaderOracle(h)).toMatchObject({ accepted: true, width: 4, height: 2 });
    h[66] = 3;
    expect(pcxHeaderOracle(h)).toMatchObject({ accepted: false, kind: 'invalid', condition: 9 });
    h[65] = 2;
    expect(pcxHeaderOracle(h)).toMatchObject({ accepted: false, kind: 'format', numbers: [8, 2] });
  });
});

describe('markdown oracles', () => {
  it('enumerates the readings of a run of four stars', () => {
    const all = markdownLineDecompositions('**a****b**');
    expect(all.length).toBeGreaterThan(1);
    expect(markdownLineDecompositions('*a').length).toBe(0);
  });

  it('checks balance, hugging and escapes', () => {
    expect(lineMarkersBalanced('**bold** and *em*')).toBe(true);
    expect(lineMarkersBalanced('*bold')).toBe(false);
    expect(lineMarkersBalanced('**bold*')).toBe(false);
    expect(lineMarkersBalanced('plain \\* star')).toBe(true);
    expect(lineMarkersBalanced('*a**b')).toBe(false);
    expect(findMarkdownDecomposition('***a***')).not.toBeNull();
  });

  it('checks style per character', () => {
    const plain = { bold: false, emphasis: false };
    const bold = { bold: true, emphasis: false };
    expect(lineMatchesStyles('a**b**', [plain, bold])).toBe(true);
    expect(lineMatchesStyles('a**b**', [plain, { bold: false, emphasis: true }])).toBe(false);
    expect(lineMatchesStyles('a**b**', [plain])).toBe(false);
  });
});

describe('plain text oracles', () => {
  it('plainTextOracle: line endings, EOF cut, DEL, empty, high byte', () => {
    expect(plainTextOracle(bytesOf('a\r\nb')).text).toBe('a\nb');
    expect(plainTextOracle(bytesOf('a\rb')).text).toBe('a\nb');
    expect(plainTextOracle(bytesOf('a\nb')).text).toBe('a\nb');
    expect(plainTextOracle(bytesOf('a\r\rb')).text).toBe('a\n\nb');
    expect(plainTextOracle(Uint8Array.of(0x61, 0x1a, 0x62, 0x01))).toEqual({ text: 'a', dropped: 0 });
    expect(plainTextOracle(Uint8Array.of(0x61, 0x7f, 0x00, 0x62))).toEqual({ text: 'ab', dropped: 2 });
    expect(plainTextOracle(new Uint8Array(0))).toEqual({ text: '', dropped: 0 });
    expect(plainTextOracle(Uint8Array.of(0xff)).text).toBe(decodeCp437(Uint8Array.of(0xff)));
    expect(plainTextOracle(Uint8Array.of(0x09, 0x0c)).text).toBe('\t\f');
  });

  it('isTextSampleOracle: empty is not text, controls are not text', () => {
    expect(isTextSampleOracle(new Uint8Array(0))).toBe(false);
    expect(isTextSampleOracle(bytesOf('hi\r\n\t\f'))).toBe(true);
    expect(isTextSampleOracle(Uint8Array.of(0x68, 0x1a))).toBe(true);
    expect(isTextSampleOracle(Uint8Array.of(0x68, 0x01))).toBe(false);
    expect(isTextSampleOracle(Uint8Array.of(0x68, 0x7f))).toBe(false);
    expect(isTextSampleOracle(Uint8Array.of(0x68, 0xff))).toBe(false);
  });

  it('detectFullOracle: rule order', () => {
    expect(detectFullOracle(bytesOf('hello'))).toEqual({ format: 'text', source: 'content' });
    expect(detectFullOracle(Uint8Array.of(1, 2), 'a.TXT')).toEqual({ format: 'text', source: 'extension' });
    expect(detectFullOracle(Uint8Array.of(1, 2), 'READ.me')).toEqual({ format: 'text', source: 'extension' });
    expect(detectFullOracle(Uint8Array.of(1, 2), 'a.ws')).toEqual({ format: 'wordstar', source: 'extension' });
    expect(detectFullOracle(bytesOf('hello'), 'a.dbf')).toEqual({ format: 'dbase', source: 'extension' });
    expect(detectFullOracle(Uint8Array.of(0x0a, 5, 1, 8), 'a.txt')).toEqual({ format: 'pcx', source: 'content' });
    expect(detectFullOracle(new Uint8Array(0))).toEqual({ format: 'unknown', source: 'none' });
    expect(detectFullOracle(new Uint8Array(0), 'E.TXT')).toEqual({ format: 'text', source: 'extension' });
    expect(detectFullOracle(Uint8Array.of(1), 42)).toEqual({ format: 'unknown', source: 'none' });
  });

  it('detectFullOracle: binary extension vetoes WordStar content', () => {
    const doc = bytesOf('.PA\r\nhi');
    expect(detectFullOracle(doc, 'A.TXT')).toEqual({ format: 'wordstar', source: 'content' });
    expect(detectFullOracle(doc, 'README')).toEqual({ format: 'wordstar', source: 'content' });
    expect(detectFullOracle(doc, 'RUN.COM')).toEqual({ format: 'text', source: 'content' });
    expect(detectFullOracle(doc, 'FREEDOS.001')).toEqual({ format: 'text', source: 'content' });
    expect(detectFullOracle(Uint8Array.of(0x41, 0x8d, 0x0a), 'X.EXE')).toEqual({ format: 'unknown', source: 'none' });
    // the veto is for WordStar only: PCX content survives a binary extension
    expect(detectFullOracle(Uint8Array.of(0x0a, 5, 1, 8), 'P.COM')).toEqual({ format: 'pcx', source: 'content' });
  });

  it('encodeCp437: round trip and null for an unmappable character', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    const text = decodeCp437(all);
    const encoded = encodeCp437(text);
    expect(encoded).not.toBeNull();
    expect(decodeCp437(encoded as Uint8Array)).toBe(text);
    expect(Array.from(encodeCp437('A\n') as Uint8Array)).toEqual([0x41, 0x0a]);
    expect(encodeCp437('\u4e2d')).toBeNull();
    expect(encodeCp437('')).toEqual(new Uint8Array(0));
  });
});

describe('result invariants', () => {
  it('accepts a valid markdown success and a valid failure', () => {
    expect(
      checkResultInvariants({ ok: true, output: 'hi', mime: 'text/markdown', extension: '.md', warnings: [] }),
    ).toEqual([]);
    expect(
      checkResultInvariants({
        ok: false,
        error: 'PCX header too short: 12 bytes',
        warnings: [{ code: 'pcx-palette-missing', message: 'no 256-colour palette found, grayscale used' }],
      }),
    ).toEqual([]);
  });

  it('reports contract violations', () => {
    expect(digitSkeleton('a 12 b 3')).toBe('a # b #');
    const bad = checkResultInvariants({
      ok: true,
      output: 'a\u0000',
      mime: 'text/csv',
      extension: '.md',
      warnings: [{ code: 'input-truncated', message: 'free text' }],
    });
    expect(bad.length).toBe(3);
    expect(checkResultInvariants({ ok: false, error: '', warnings: [] }).length).toBeGreaterThan(0);
    expect(checkResultInvariants({ ok: true, output: new Uint8Array(5), mime: 'image/png', extension: '.png', warnings: [] }).length).toBeGreaterThan(0);
  });
});
