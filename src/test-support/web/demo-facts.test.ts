// Example tests: the static page agrees with the committed demo disks.
// Requirements 5.1, 5.2, 5.7, 9.2, 9.4, 9.7, 10.3-10.8.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { convertAuto } from '../../core/formats';
import { formatBytes } from '../../web/logic/size';
import { byteTotals, checkBar, checkExcerpts, checkHeadstones, demoByteTotals, demoFileCounts, loadDemo } from './demo-facts';
import { parseHtml } from './html-scan';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

const html = parseHtml(read('index.html'));
const css = read('src/style.css');
const logoPng = new Uint8Array(readFileSync(join(ROOT, 'src', 'assets', 'img', 'logo-pcx.png')));
const writers = loadDemo('writers-disk');
const office = loadDemo('office-disk');

describe('demo facts: headstones', () => {
  it('match the Writer_Disk report', () => {
    expect(checkHeadstones(html, writers.report)).toEqual([]);
  });

  it('reject a changed state', () => {
    const files = writers.report.files.map((g, i) => (i === 0 ? { ...g, state: 'lost' as const } : g));
    expect(checkHeadstones(html, { ...writers.report, files })).not.toEqual([]);
  });
});

describe('demo facts: bar', () => {
  const totals = demoByteTotals();

  it('computes the documented byte totals', () => {
    expect(totals).toEqual({ alive: 10_600, recovered: 3_468, partlyBack: 2_048, lost: 1_024 });
    expect(Object.values(totals).map(formatBytes)).toEqual(['10.4 KB', '3.4 KB', '2.0 KB', '1.0 KB']);
  });

  it('matches aria-label, figures and CSS flex values', () => {
    expect(checkBar(html, css, totals)).toEqual([]);
  });

  it('rejects wrong totals', () => {
    expect(checkBar(html, css, { ...totals, lost: totals.lost + 1 })).not.toEqual([]);
  });

  it('has the documented file counts', () => {
    expect(demoFileCounts()).toEqual({ alive: 4, recovered: 1, partlyBack: 1, lost: 0 });
  });

  it('rejects a number word that differs from the disk count', () => {
    const counts = demoFileCounts();
    expect(checkBar(html, css, totals, { ...counts, alive: 3 }).join('\n')).toContain('says 4 but the disk has 3');
    expect(checkBar(html, css, totals, { ...counts, recovered: 2 }).join('\n')).toContain('says 1 but the disk has 2');
  });

  it('rejects a wrong number word or digits in the segment line', () => {
    const three = parseHtml(readFileSync(join(ROOT, 'index.html'), 'utf8').replace('Alive. Four files', 'Alive. Three files'));
    expect(checkBar(three, css, totals).join('\n')).toContain('says 3 but the disk has 4');
    const digits = parseHtml(readFileSync(join(ROOT, 'index.html'), 'utf8').replace('Alive. Four files', 'Alive. 5 files'));
    expect(checkBar(digits, css, totals).join('\n')).toContain('says 5 but the disk has 4');
  });

  it('counts a partial file by readable bytes', () => {
    const t = byteTotals(writers.report, () => 0);
    expect(t.partlyBack).toBe(0);
    expect(t.lost).toBe(totals.lost + totals.partlyBack);
  });
});

describe('demo facts: excerpts, logo and captions', () => {
  const src = { writers, office, logoPng, css };

  it('match converter output', () => {
    expect(checkExcerpts(html, src)).toEqual([]);
  });

  it('logo-pcx.png equals the converter output with a 64x40 IHDR', () => {
    const g = office.report.files.find((f) => f.path === '/LOGO.PCX')!;
    const r = office.handle.readBytes(g);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = convertAuto(r.bytes, 'LOGO.PCX');
    expect(c.ok).toBe(true);
    if (!c.ok || typeof c.output === 'string') return;
    expect(Array.from(logoPng)).toEqual(Array.from(c.output));
    const dv = new DataView(logoPng.buffer, logoPng.byteOffset, logoPng.byteLength);
    expect([dv.getUint32(16), dv.getUint32(20)]).toEqual([64, 40]);
  });

  it('rejects a different logo', () => {
    const bad = logoPng.slice();
    bad[bad.length - 1] ^= 0xff;
    expect(checkExcerpts(html, { ...src, logoPng: bad })).not.toEqual([]);
  });

  it('rejects a caption that names the wrong file', () => {
    const swapped = parseHtml(read('index.html').replace('CUSTOMER.DBF from', 'OTHER.DBF from'));
    expect(checkExcerpts(swapped, src).join('\n')).toContain('caption lacks CUSTOMER.DBF');
  });
});
