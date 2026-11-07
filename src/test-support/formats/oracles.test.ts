import { describe, expect, it } from 'vitest';
import { checkResultInvariants, digitSkeleton } from './invariants';
import {
  dbfHeaderOracle,
  detectOracle,
  expectedCell,
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
