import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Warning } from '../../core/fat12/index';
import type { ConversionWarning } from '../../core/formats/index';
import { numRuns } from '../../test-support/runs';
import { buildPreviewModel, kindLabel } from './preview-model';
import type { ExhumeOutcome, PreviewBody } from './preview-model';
import type { CsvTable } from './csv-display';
import type { ExhumeResult } from './protocol';
import type { ItemViewModel } from './viewmodel';
import { stateWord } from './viewmodel';
import { sanitizeFileName } from './filename';
import { truncateForPreview } from './markdown';
import { toLabel } from './text';
import { MD_PREVIEW_CHARS } from './limits';

const ALLOWED_MIMES = ['text/markdown', 'text/csv', 'text/plain', 'image/png', 'application/octet-stream'];

const itemArb: fc.Arbitrary<ItemViewModel> = fc
  .record({
    name: fc.oneof(fc.string({ maxLength: 40 }), fc.string({ minLength: 250, maxLength: 300 })),
    state: fc.constantFrom('alive', 'recovered', 'partial', 'lost') as fc.Arbitrary<ItemViewModel['state']>,
    reason: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 80 })),
  })
  .map(
    (r): ItemViewModel => ({
      id: 1,
      kind: 'file',
      state: r.state,
      stateLabel: stateWord(r.state),
      visual: r.state === 'alive' ? 'tombstone' : 'open-grave',
      name: r.name,
      path: r.name,
      showPath: false,
      sizeText: '0 B',
      dateText: '',
      reason: r.reason,
      marker: null,
      action: 'exhume',
      note: null,
      nameHint: null,
    }),
  );

const readWarningArb: fc.Arbitrary<Warning> = fc.record(
  { code: fc.constant('internal-error' as Warning['code']), message: fc.string({ maxLength: 30 }), path: fc.string({ maxLength: 12 }) },
  { requiredKeys: ['code', 'message'] },
);
const convWarningArb: fc.Arbitrary<ConversionWarning> = fc.record({
  code: fc.constant('input-truncated' as ConversionWarning['code']),
  message: fc.string({ maxLength: 30 }),
});

const rawArb = fc.oneof(fc.uint8Array({ maxLength: 200 }), fc.uint8Array({ minLength: 4090, maxLength: 4200 }));
const textArb = fc.string({ maxLength: 200 });

const resultArb = (warnings: ConversionWarning[]): fc.Arbitrary<ExhumeResult> =>
  fc.oneof(
    textArb.map((text): ExhumeResult => ({ kind: 'markdown', text, warnings })),
    textArb.map((text): ExhumeResult => ({ kind: 'csv', text, warnings })),
    textArb.map((text): ExhumeResult => ({ kind: 'text', text, warnings })),
    fc.uint8Array({ maxLength: 100 }).map((png): ExhumeResult => ({ kind: 'png', png, warnings })),
    fc.string({ minLength: 1, maxLength: 40 }).map((error): ExhumeResult => ({ kind: 'raw', error, warnings })),
  );

const okArb = fc
  .tuple(itemArb, fc.array(readWarningArb, { maxLength: 6 }), fc.array(convWarningArb, { maxLength: 6 }), rawArb)
  .chain(([item, readWarnings, convWarnings, raw]) =>
    resultArb(convWarnings).map((result) => ({
      item,
      readWarnings,
      convWarnings,
      raw,
      result,
      outcome: {
        status: 'ok',
        response: { type: 'exhumed', id: 1, graveId: 1, raw, readWarnings, result },
      } as ExhumeOutcome,
    })),
  );

describe('buildPreviewModel', () => {
  it('lists a converted download and the raw download for markdown', () => {
    const item = fc.sample(itemArb, 1)[0]!;
    const raw = Uint8Array.of(35, 32, 104, 105);
    const m = buildPreviewModel(item, {
      status: 'ok',
      response: { type: 'exhumed', id: 1, graveId: 1, raw, readWarnings: [], result: { kind: 'markdown', text: '# hi', warnings: [] } },
    });
    expect(m.downloads.map((d) => d.mime)).toEqual(['text/markdown', 'application/octet-stream']);
    expect(m.body.kind).toBe('markdown');
  });

  // Feature: graveyard-ui, Property 28: The preview model matches the worker result
  // **Validates: Requirements 9.7, 9.10, 9.12, 9.13, 9.14, 9.15, 9.17, 9.18, 10.1, 10.2, 10.3**
  it('Property 28: matches the worker result', () => {
    const failures: string[] = [];
    fc.assert(
      fc.property(okArb, ({ item, readWarnings, convWarnings, raw, result, outcome }) => {
        const m = buildPreviewModel(item, outcome);
        const expectedWarnings = [
          ...readWarnings.map((w) => (w.path !== undefined && w.path !== '' ? `${w.message} (${w.path})` : w.message)),
          ...convWarnings.map((w) => w.message),
        ];
        const checks: boolean[] = [];
        checks.push(JSON.stringify(m.warnings) === JSON.stringify(expectedWarnings));
        checks.push(m.partialNote === (item.state === 'partial' ? item.reason : null));
        checks.push(m.title === toLabel(item.name));
        checks.push(m.error === (result.kind === 'raw' ? result.error : null));

        const b = m.body;
        if (result.kind === 'markdown') {
          const t = truncateForPreview(result.text);
          checks.push(b.kind === 'markdown' && b.text === t.text && b.shortened === t.shortened);
        } else if (result.kind === 'csv') {
          checks.push(b.kind === 'csv');
        } else if (result.kind === 'text') {
          const t = truncateForPreview(result.text);
          checks.push(b.kind === 'text' && b.text === t.text && b.shortened === t.shortened);
        } else if (result.kind === 'png') {
          checks.push(b.kind === 'png' && b.png === result.png && b.alt === sanitizeFileName(item.name, '.png'));
        } else {
          checks.push(
            b.kind === 'hex' &&
              b.totalBytes === raw.length &&
              b.shownBytes === Math.min(raw.length, 4096) &&
              b.rows.length === Math.ceil(Math.min(raw.length, 4096) / 16),
          );
        }

        const last = m.downloads[m.downloads.length - 1];
        checks.push(
          last !== undefined &&
            last.mime === 'application/octet-stream' &&
            last.fileName.endsWith('.bin') &&
            last.data === raw,
        );
        if (result.kind === 'raw') {
          checks.push(m.downloads.length === 1);
        } else {
          const first = m.downloads[0];
          const ext =
            result.kind === 'markdown' ? '.md' : result.kind === 'csv' ? '.csv' : result.kind === 'text' ? '.txt' : '.png';
          const mime =
            result.kind === 'markdown'
              ? 'text/markdown'
              : result.kind === 'csv'
                ? 'text/csv'
                : result.kind === 'text'
                  ? 'text/plain'
                  : 'image/png';
          const data = result.kind === 'png' ? result.png : result.text;
          checks.push(
            m.downloads.length === 2 &&
              first !== undefined &&
              first.mime === mime &&
              first.fileName === sanitizeFileName(item.name, ext) &&
              first.data === data,
          );
        }
        checks.push(m.downloads.every((d) => ALLOWED_MIMES.includes(d.mime)));
        const ok = checks.every(Boolean);
        if (!ok) failures.push(checks.join(','));
        return ok;
      }),
      { numRuns: numRuns(200) },
    );
    expect(failures).toEqual([]);
  });

  // Feature: plain-text, Property 14: Text preview model
  // **Validates: Requirements 4.3, 4.4, 4.5, 4.6**
  it('Property 14: text preview model', () => {
    const textBodyArb = fc.oneof(
      fc.string({ maxLength: 200 }),
      fc
        .tuple(fc.constantFrom(MD_PREVIEW_CHARS - 1, MD_PREVIEW_CHARS, MD_PREVIEW_CHARS + 1, MD_PREVIEW_CHARS + 500), fc.string({ maxLength: 5 }))
        .map(([len, head]) => (head + 'x'.repeat(len)).slice(0, len)),
    );
    fc.assert(
      fc.property(
        itemArb,
        textBodyArb,
        fc.array(convWarningArb, { maxLength: 4 }),
        fc.uint8Array({ maxLength: 100 }),
        (item, text, warnings, raw) => {
          const m = buildPreviewModel(item, {
            status: 'ok',
            response: { type: 'exhumed', id: 1, graveId: 1, raw, readWarnings: [], result: { kind: 'text', text, warnings } },
          });
          const t = truncateForPreview(text);
          const first = m.downloads[0];
          const last = m.downloads[m.downloads.length - 1];
          return (
            m.body.kind === 'text' &&
            m.body.text === t.text &&
            m.body.shortened === text.length > MD_PREVIEW_CHARS &&
            first !== undefined &&
            first.mime === 'text/plain' &&
            first.fileName.endsWith('.txt') &&
            first.fileName === sanitizeFileName(item.name, '.txt') &&
            first.data === text &&
            last !== undefined &&
            last.mime === 'application/octet-stream' &&
            last.fileName.endsWith('.bin') &&
            m.downloads.every((d) => ALLOWED_MIMES.includes(d.mime))
          );
        },
      ),
      { numRuns: numRuns(100) },
    );
  });

  it('kindLabel names each body kind and marks partial items', () => {
    const item = fc.sample(itemArb, 1)[0]!;
    const cases: Array<[PreviewBody, string]> = [
      [{ kind: 'markdown', text: '', shortened: false }, 'Read as Markdown'],
      [{ kind: 'csv', table: { header: [], rows: [] } as unknown as CsvTable }, 'Read as CSV'],
      [{ kind: 'text', text: '', shortened: false }, 'Plain text'],
      [{ kind: 'png', png: new Uint8Array(0), alt: 'x' }, 'Read as PNG'],
      [{ kind: 'hex', rows: [], totalBytes: 0, shownBytes: 0 }, 'Raw bytes'],
      [{ kind: 'none' }, 'Nothing to read'],
    ];
    for (const [body, label] of cases) {
      expect(kindLabel(body, 'alive')).toBe(label);
      expect(kindLabel(body, 'recovered')).toBe(label);
      expect(kindLabel(body, 'partial')).toBe(`${label}, partly`);
    }
    const failed = buildPreviewModel({ ...item, state: 'partial' }, { status: 'read-failed', error: 'x' });
    expect(failed.kindLabel).toBe('Nothing to read, partly');
  });

  it('Property 28: a read failure gives error, no body and no downloads', () => {
    fc.assert(
      fc.property(
        itemArb,
        fc.string({ minLength: 1, maxLength: 40 }),
        fc.constantFrom('read-failed', 'lost-disk') as fc.Arbitrary<'read-failed' | 'lost-disk'>,
        (item, error, status) => {
          const m = buildPreviewModel(item, { status, error });
          return m.error === error && m.body.kind === 'none' && m.downloads.length === 0;
        },
      ),
      { numRuns: numRuns(100) },
    );
  });
});
