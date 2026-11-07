// Expectation tables: what the Reader must report for each demo disk.
// The (path, kind, state) rows are typed by hand from the design. Sizes come from the authored
// sources and dates from content/dates.ts, never from the Reader or the writer.

import type { DiskPlan } from '../build';
import {
  DAMAGED_LETTER,
  DAMAGED_MEMO,
  DAMAGED_README,
  OFFICE_CUSTOMER,
  OFFICE_INVOICE,
  OFFICE_INVOICES_DIR,
  OFFICE_LOGO,
  OFFICE_OLDCUST,
  OFFICE_README,
  WRITERS_CHAPTER1,
  WRITERS_CHAPTER2,
  WRITERS_CHAPTER3,
  WRITERS_DRAFT1,
  WRITERS_DRAFT2,
  WRITERS_README,
} from '../content/dates';
import type { DemoDiskId } from '../specs';

export interface ExpectedGrave {
  /** Reader-side path, for example `/_RAFT1.WS`. */
  path: string;
  kind: 'file' | 'directory';
  state: 'alive' | 'recovered' | 'partial' | 'lost';
  /** Files: derived from the sources; directories: 0. */
  size: number;
  /** `YYYY-MM-DDTHH:MM:SS`, from content/dates.ts. */
  date: string;
}

export interface Expectation {
  id: DemoDiskId;
  geometrySource: 'bpb' | 'fallback';
  /** Exact set, in directory order. */
  graves: ExpectedGrave[];
  /** Sorted. */
  warningCodes: string[];
  /** Reader-side paths whose conversion is expected to fail (README and invoice text files). */
  noConverter: string[];
}

/** Cluster size of all three demo geometries. */
const CLUSTER_BYTES = 1024;
/** Extra bytes the `size-exceeds-chain` damage adds on top of the chain bytes. */
const EXTRA_BYTES = 1024;

function sourceSize(plan: DiskPlan, authorPath: string): number {
  const bytes = plan.sources.get(authorPath);
  if (bytes === undefined) throw new Error(`no source for ${authorPath}`);
  return bytes.length;
}

/** Declared size after `size-exceeds-chain`: bytes of the whole clusters of the chain, plus the extra. */
function inflatedSize(plan: DiskPlan, authorPath: string): number {
  const clusters = Math.max(1, Math.ceil(sourceSize(plan, authorPath) / CLUSTER_BYTES));
  return clusters * CLUSTER_BYTES + EXTRA_BYTES;
}

export function expectationOf(id: DemoDiskId, plan: DiskPlan): Expectation {
  switch (id) {
    case 'writers-disk':
      return {
        id,
        geometrySource: 'bpb',
        graves: [
          { path: '/CHAPTER1.WS', kind: 'file', state: 'alive', size: sourceSize(plan, '/CHAPTER1.WS'), date: WRITERS_CHAPTER1.expected },
          { path: '/_RAFT1.WS', kind: 'file', state: 'recovered', size: sourceSize(plan, '/DRAFT1.WS'), date: WRITERS_DRAFT1.expected },
          { path: '/CHAPTER2.WS', kind: 'file', state: 'alive', size: sourceSize(plan, '/CHAPTER2.WS'), date: WRITERS_CHAPTER2.expected },
          { path: '/_RAFT2.WS', kind: 'file', state: 'partial', size: inflatedSize(plan, '/DRAFT2.WS'), date: WRITERS_DRAFT2.expected },
          { path: '/CHAPTER3.WS', kind: 'file', state: 'alive', size: sourceSize(plan, '/CHAPTER3.WS'), date: WRITERS_CHAPTER3.expected },
          { path: '/README.TXT', kind: 'file', state: 'alive', size: sourceSize(plan, '/README.TXT'), date: WRITERS_README.expected },
        ],
        warningCodes: [],
        noConverter: ['/README.TXT'],
      };
    case 'office-disk':
      return {
        id,
        geometrySource: 'bpb',
        graves: [
          { path: '/CUSTOMER.DBF', kind: 'file', state: 'alive', size: sourceSize(plan, '/CUSTOMER.DBF'), date: OFFICE_CUSTOMER.expected },
          { path: '/LOGO.PCX', kind: 'file', state: 'alive', size: sourceSize(plan, '/LOGO.PCX'), date: OFFICE_LOGO.expected },
          { path: '/INVOICES', kind: 'directory', state: 'alive', size: 0, date: OFFICE_INVOICES_DIR.expected },
          { path: '/INVOICES/INV8903.TXT', kind: 'file', state: 'alive', size: sourceSize(plan, '/INVOICES/INV8903.TXT'), date: OFFICE_INVOICE.expected },
          { path: '/_LDCUST.DBF', kind: 'file', state: 'lost', size: sourceSize(plan, '/OLDCUST.DBF'), date: OFFICE_OLDCUST.expected },
          { path: '/README.TXT', kind: 'file', state: 'alive', size: sourceSize(plan, '/README.TXT'), date: OFFICE_README.expected },
        ],
        warningCodes: [],
        noConverter: ['/INVOICES/INV8903.TXT', '/README.TXT'],
      };
    case 'damaged-disk':
      return {
        id,
        geometrySource: 'fallback',
        graves: [
          { path: '/LETTER.WS', kind: 'file', state: 'partial', size: inflatedSize(plan, '/LETTER.WS'), date: DAMAGED_LETTER.expected },
          { path: '/MEMO.WS', kind: 'file', state: 'alive', size: sourceSize(plan, '/MEMO.WS'), date: DAMAGED_MEMO.expected },
          { path: '/README.TXT', kind: 'file', state: 'alive', size: sourceSize(plan, '/README.TXT'), date: DAMAGED_README.expected },
        ],
        warningCodes: ['bpb-invalid', 'chain-cycle'],
        noConverter: ['/README.TXT'],
      };
  }
}
