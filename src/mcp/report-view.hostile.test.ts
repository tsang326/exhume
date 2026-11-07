import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { openDisk } from '../core/fat12/index';
import type { DiskReport, Grave, GraveKind, GraveState, Warning } from '../core/fat12/index';
import { hostileImageArb } from '../test-support/hostile';
import { numRuns } from '../test-support/runs';
import { timed } from '../test-support/timed';
import { MAX_NAME_CHARS, MAX_REASON_CHARS_OUT, MAX_REPORT_ENTRIES, MAX_REPORT_WARNINGS, MAX_RESPONSE_BYTES } from './limits';
import { toReportView } from './report-view';
import type { OpenDiskResult } from './report-view';

const STATES: GraveState[] = ['alive', 'recovered', 'partial', 'lost'];
const KINDS: GraveKind[] = ['file', 'directory'];

const HOSTILE_UNITS = [
  0x00, 0x07, 0x09, 0x0a, 0x0d, 0x1b, 0x22, 0x5c, 0x7f, 0x85, 0x2028, 0x2029, 0x202e, 0x2066, 0xfeff, 0xd800, 0xdbff,
  0xdc00, 0xdfff, 0x41, 0x4e2d,
];
const unitArb = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(...HOSTILE_UNITS) },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: 0xffff }) },
);
const pairArb = fc.integer({ min: 0x10000, max: 0x10ffff }).map((cp) => String.fromCodePoint(cp));

function textArb(maxLength: number): fc.Arbitrary<string> {
  return fc
    .array(
      fc.oneof(
        { weight: 6, arbitrary: unitArb.map((u) => String.fromCharCode(u)) },
        { weight: 1, arbitrary: pairArb },
      ),
      { maxLength },
    )
    .map((parts) => parts.join(''));
}

// Long text, so caps are exercised.
const longTextArb = fc.oneof(
  { weight: 3, arbitrary: textArb(40) },
  { weight: 1, arbitrary: fc.tuple(textArb(8), fc.integer({ min: 100, max: 700 })).map(([s, n]) => (s || 'x').repeat(n)) },
);

const graveArb = fc.record({
  path: longTextArb,
  size: fc.integer({ min: 0, max: 4_294_967_295 }),
  state: fc.constantFrom(...STATES),
  kind: fc.constantFrom(...KINDS),
  date: fc.option(fc.constant('1990-01-02T03:04:05'), { nil: null }),
  reason: fc.option(longTextArb, { nil: undefined }),
});

const warningArb = fc.record({
  message: longTextArb,
  path: fc.option(longTextArb, { nil: undefined }),
});

const reportArb: fc.Arbitrary<DiskReport> = fc
  .record({
    label: longTextArb,
    graves: fc.array(graveArb, { maxLength: 400 }),
    warnings: fc.array(warningArb, { maxLength: 120 }),
  })
  .map(({ label, graves, warnings }) => buildReport(label, graves, warnings));

function buildReport(
  label: string,
  graves: Array<{ path: string; size: number; state: GraveState; kind: GraveKind; date: string | null; reason: string | undefined }>,
  warnings: Array<{ message: string; path: string | undefined }>,
): DiskReport {
  const files: Grave[] = graves.map((g, id) => {
    const grave: Grave = {
      id,
      path: g.path,
      size: g.size,
      date: g.date,
      state: g.state,
      kind: g.kind,
      attributes: { readOnly: false, hidden: false, system: false, archive: false },
      startCluster: 2,
    };
    if (g.reason !== undefined) grave.reason = g.reason;
    return grave;
  });
  const ws: Warning[] = warnings.map((w) => {
    const warning: Warning = { code: 'lfn-invalid', message: w.message };
    if (w.path !== undefined) warning.path = w.path;
    return warning;
  });
  return { volume: { label, geometrySource: 'bpb', geometry: null }, files, warnings: ws };
}

function isForbidden(c: number): boolean {
  return (
    c <= 0x1f ||
    c === 0x7f ||
    (c >= 0x80 && c <= 0x9f) ||
    c === 0x2028 ||
    c === 0x2029 ||
    (c >= 0x202a && c <= 0x202e) ||
    (c >= 0x2066 && c <= 0x2069) ||
    c === 0xfeff
  );
}

/** True when `s` is within `cap` units, has no forbidden unit and no lone surrogate. */
function cleanWithin(s: string, cap: number): boolean {
  if (s.length > cap) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (isForbidden(c)) return false;
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (n < 0xdc00 || n > 0xdfff) return false;
      i += 1;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function respSize(view: OpenDiskResult): number {
  return Buffer.byteLength(JSON.stringify(view), 'utf8');
}

/** All structural rules of Property 15 as one boolean. */
function obeysCaps(report: DiskReport, view: OpenDiskResult): boolean {
  const n = report.files.length;
  const expectedCounts = { alive: 0, recovered: 0, partial: 0, lost: 0 };
  for (const g of report.files) expectedCounts[g.state] += 1;
  const sum = view.counts.alive + view.counts.recovered + view.counts.partial + view.counts.lost;
  const keptWarnings = Math.min(report.warnings.length, MAX_REPORT_WARNINGS);

  const members = Object.keys(view).join(',') === 'untrusted,notice,volume,totalEntries,counts,entries,truncated,warnings,warningsOmitted';
  const counts =
    sum === n &&
    view.totalEntries === n &&
    view.counts.alive === expectedCounts.alive &&
    view.counts.recovered === expectedCounts.recovered &&
    view.counts.partial === expectedCounts.partial &&
    view.counts.lost === expectedCounts.lost;
  const entries =
    view.entries.length === Math.min(n, MAX_REPORT_ENTRIES) &&
    view.truncated === n > MAX_REPORT_ENTRIES &&
    view.entries.every(
      (e, i) =>
        e.id === report.files[i]?.id &&
        cleanWithin(e.path, MAX_NAME_CHARS) &&
        (e.reason === undefined || cleanWithin(e.reason, MAX_REASON_CHARS_OUT)),
    );
  const warnings =
    view.warnings.length === keptWarnings &&
    view.warningsOmitted === report.warnings.length - keptWarnings &&
    view.warnings.every(
      (w) =>
        cleanWithin(w.message, MAX_REASON_CHARS_OUT) && (w.path === undefined || cleanWithin(w.path, MAX_NAME_CHARS)),
    );
  const label = cleanWithin(view.volume.label, MAX_NAME_CHARS);
  const envelope = view.untrusted === true && view.notice.length > 0;
  const size = respSize(view) <= MAX_RESPONSE_BYTES;
  return members && counts && entries && warnings && label && envelope && size;
}

describe('report view caps', () => {
  // Feature: mcp-server, Property 15: The report view obeys its caps on any report
  // **Validates: Requirements 7.2, 7.3, 7.4, 7.5, 7.7, 7.9, 12.2**
  it('holds on synthetic reports with hostile text', () => {
    fc.assert(
      fc.property(reportArb, (report) => obeysCaps(report, toReportView(report))),
      { numRuns: numRuns(60) },
    );
  });

  // Feature: mcp-server, Property 15: The report view obeys its caps on any report
  // **Validates: Requirements 7.2, 7.3, 7.4, 7.5, 7.7, 7.9, 12.2**
  it('holds on reports read from hostile images', () => {
    fc.assert(
      fc.property(hostileImageArb, (h) => {
        const report = timed(() => openDisk(h.image).report, 5_000);
        return obeysCaps(report, toReportView(report));
      }),
      { numRuns: numRuns(40) },
    );
  });
});

describe('report view worst case', () => {
  it('keeps a report of 400 all-quote graves and 120 all-quote warnings under the response cap', () => {
    const quotes = '"'.repeat(1_000);
    const graves = Array.from({ length: 400 }, () => ({
      path: quotes,
      size: 4_294_967_295,
      state: 'partial' as GraveState,
      kind: 'file' as GraveKind,
      date: '1990-01-02T03:04:05',
      reason: quotes,
    }));
    const warnings = Array.from({ length: 120 }, () => ({ message: quotes, path: quotes }));
    const report = buildReport(quotes, graves, warnings);
    const view = toReportView(report);
    expect(view.entries).toHaveLength(MAX_REPORT_ENTRIES);
    expect(view.truncated).toBe(true);
    expect(view.warnings).toHaveLength(MAX_REPORT_WARNINGS);
    expect(view.warningsOmitted).toBe(70);
    expect(respSize(view)).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);
    expect(obeysCaps(report, view)).toBe(true);
  });

  it('keeps an empty report valid', () => {
    const view = toReportView(buildReport('', [], []));
    expect(view.entries).toEqual([]);
    expect(view.truncated).toBe(false);
    expect(view.warningsOmitted).toBe(0);
  });
});
