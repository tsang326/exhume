import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { DiskReport, Grave, Warning } from '../../core/fat12/index';
import { toItemViewModels, summarize, warningLines } from './viewmodel';
import { lastSegment, segmentCount, toLabel } from './text';
import { numRuns } from '../../test-support/runs';

const stateArb = fc.constantFrom('alive', 'recovered', 'partial', 'lost') as fc.Arbitrary<Grave['state']>;
const kindArb = fc.constantFrom('file', 'directory') as fc.Arbitrary<Grave['kind']>;
const pathArb = fc.oneof(
  fc.string({ maxLength: 20 }),
  fc.array(fc.string({ maxLength: 8 }), { maxLength: 5 }).map((p) => '/' + p.join('/')),
  fc.string({ minLength: 250, maxLength: 400 }),
);
const dateArb = fc.oneof(
  fc.constant(null),
  fc.constant('2024-02-29T13:45:59'),
  fc.string({ maxLength: 25 }),
);
const sizeArb = fc.oneof(fc.constant(4_294_967_295), fc.constant(0), fc.integer({ min: 0, max: 4_294_967_295 }));

const graveArb = (id: number): fc.Arbitrary<Grave> =>
  fc
    .record({
      path: pathArb,
      size: sizeArb,
      date: dateArb,
      state: stateArb,
      kind: kindArb,
      reason: fc.string({ minLength: 1, maxLength: 200 }),
    })
    .map((r) => ({
      id,
      path: r.path,
      size: r.size,
      date: r.date,
      state: r.state,
      kind: r.kind,
      ...(r.state === 'alive' ? {} : { reason: r.reason }),
      attributes: { readOnly: false, hidden: false, system: false, archive: false },
      startCluster: 2,
    }));

const gravesArb = fc
  .integer({ min: 0, max: 12 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => graveArb(i))));

const warningArb: fc.Arbitrary<Warning> = fc.record(
  { code: fc.constant('chain-short' as const), message: fc.string({ minLength: 1, maxLength: 40 }), path: fc.string({ minLength: 1, maxLength: 20 }) },
  { requiredKeys: ['code', 'message'] },
);

const reportArb: fc.Arbitrary<DiskReport> = fc.record({
  volume: fc.record({
    label: fc.oneof(fc.constant(''), fc.string({ maxLength: 11 })),
    geometrySource: fc.constantFrom('bpb', 'fallback', 'none') as fc.Arbitrary<'bpb' | 'fallback' | 'none'>,
    geometry: fc.constant(null),
  }),
  files: gravesArb,
  warnings: fc.array(warningArb, { maxLength: 6 }),
});

describe('view model properties', () => {
  // Feature: graveyard-ui, Property 17: The view-model mapping preserves every grave
  it('Property 17: mapping preserves every grave', () => {
    fc.assert(
      fc.property(reportArb, (report) => {
        const items = toItemViewModels(report);
        if (items.length !== report.files.length) return false;
        return items.every((it, i) => {
          const g = report.files[i]!;
          const seg = lastSegment(g.path);
          return (
            it.id === g.id &&
            it.stateLabel.length > 0 &&
            it.stateLabel === g.state &&
            it.name === (seg === '' ? '(unnamed)' : toLabel(seg)) &&
            it.showPath === segmentCount(g.path) > 1 &&
            (g.state === 'alive' ? it.reason === null : it.reason === g.reason) &&
            it.visual === (g.state === 'alive' ? 'tombstone' : 'open-grave') &&
            (it.action === 'exhume') === (g.kind === 'file' && g.state !== 'lost') &&
            (g.kind === 'directory' ? it.action === 'none' && it.marker === 'directory' : true) &&
            (g.state === 'lost' ? it.action === 'none' && it.note !== null : true) &&
            it.sizeText.length > 0 &&
            it.dateText.length > 0
          );
        });
      }),
      { numRuns: numRuns(200) },
    );
  });

  // Feature: graveyard-ui, Property 18: The summary and warning lines match the report
  it('Property 18: summary and warning lines match the report', () => {
    fc.assert(
      fc.property(reportArb, (report) => {
        const s = summarize(report);
        const files = report.files.filter((g) => g.kind === 'file').length;
        const dirs = report.files.length - files;
        const expectedEmpty =
          report.files.length > 0 ? null : report.volume.geometrySource === 'none' ? 'unreadable' : 'no-files';
        const lines = warningLines(report);
        return (
          s.fileCount === files &&
          s.directoryCount === dirs &&
          (s.label === '(no label)') === (report.volume.label === '') &&
          s.empty === expectedEmpty &&
          lines.length === report.warnings.length &&
          lines.every((line, i) => {
            const w = report.warnings[i]!;
            return line.includes(w.message) && (w.path === undefined || line.includes(w.path));
          })
        );
      }),
      { numRuns: numRuns(200) },
    );
  });
});

describe('view model examples', () => {
  it('formats size 4,294,967,295, null date and bad date without throwing', () => {
    const base: Grave = {
      id: 0,
      path: '/A.TXT',
      size: 4_294_967_295,
      date: null,
      state: 'alive',
      kind: 'file',
      attributes: { readOnly: false, hidden: false, system: false, archive: false },
      startCluster: 2,
    };
    const report: DiskReport = {
      volume: { label: '', geometrySource: 'bpb', geometry: null },
      files: [base, { ...base, id: 1, date: 'garbage' }],
      warnings: [],
    };
    const items = toItemViewModels(report);
    expect(items[0]!.dateText).toBe('no date');
    expect(items[1]!.dateText).toBe('no date');
    expect(items[0]!.sizeText).toBe('4096.0 MB');
    expect(summarize(report).label).toBe('(no label)');
  });
});
