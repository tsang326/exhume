import { describe, expect, it } from 'vitest';
import {
  openDisk,
  readDisk,
  readGraveBytes,
  decodeCp437,
  FALLBACK_GEOMETRIES,
  GraveState,
  GraveKind,
  GeometrySource,
  WarningCode,
  MAX_IMAGE_BYTES,
  MIN_IMAGE_BYTES,
  MAX_DIR_DEPTH,
  MAX_TOTAL_ENTRIES,
  MAX_FILE_OUTPUT_BYTES,
  MAX_NAME_UTF16,
  MAX_LFN_ENTRIES,
  MAX_REASON_CHARS,
  FAT12_MAX_DATA_CLUSTERS,
  DIR_ENTRY_BYTES,
  SCAN_TIME_BUDGET_MS,
} from './index';
import type {
  DiskHandle,
  DiskReport,
  Volume,
  Grave,
  Attributes,
  Warning,
  ReadResult,
  GeometryInfo,
} from './index';

const dummyGrave: Grave = {
  id: 0,
  path: '/A.TXT',
  size: 0,
  date: null,
  state: GraveState.Lost,
  kind: GraveKind.File,
  attributes: { readOnly: false, hidden: false, system: false, archive: false },
  startCluster: 0,
};

const badInputs: Array<[string, unknown]> = [
  ['null', null],
  ['undefined', undefined],
  ['string', 'abc'],
  ['number', 42],
  ['array', [1, 2, 3]],
  ['ArrayBuffer', new ArrayBuffer(1474560)],
  ['DataView', new DataView(new ArrayBuffer(1474560))],
];

describe('fat12 public index', () => {
  it('exposes the public values', () => {
    expect(FALLBACK_GEOMETRIES.size).toBeGreaterThan(0);
    expect(GraveState.Alive).toBe('alive');
    expect(GraveKind.File).toBe('file');
    expect(GeometrySource.None).toBe('none');
    expect(WarningCode.InternalError).toBe('internal-error');
    const limits = [
      MAX_IMAGE_BYTES, MIN_IMAGE_BYTES, MAX_DIR_DEPTH, MAX_TOTAL_ENTRIES,
      MAX_FILE_OUTPUT_BYTES, MAX_NAME_UTF16, MAX_LFN_ENTRIES, MAX_REASON_CHARS,
      FAT12_MAX_DATA_CLUSTERS, DIR_ENTRY_BYTES, SCAN_TIME_BUDGET_MS,
    ];
    for (const l of limits) expect(typeof l).toBe('number');
    expect(decodeCp437(Uint8Array.of(0x80))).toBe('Ç');
  });

  it('exposes the public types', () => {
    const report: DiskReport | undefined = undefined;
    const types: [DiskHandle?, Volume?, Attributes?, Warning?, ReadResult?, GeometryInfo?] = [];
    expect(report).toBeUndefined();
    expect(types).toHaveLength(0);
  });

  describe.each(badInputs)('rejects %s', (_name, input) => {
    it('openDisk throws TypeError', () => {
      expect(() => openDisk(input as Uint8Array)).toThrow(TypeError);
    });
    it('readDisk throws TypeError', () => {
      expect(() => readDisk(input as Uint8Array)).toThrow(TypeError);
    });
    it('readGraveBytes throws TypeError', () => {
      expect(() => readGraveBytes(input as Uint8Array, dummyGrave)).toThrow(TypeError);
    });
  });

  it('accepts a Buffer', () => {
    const image = Buffer.alloc(1474560);
    expect(() => openDisk(image)).not.toThrow();
    const report = readDisk(image);
    expect(Array.isArray(report.files)).toBe(true);
    expect(Array.isArray(report.warnings)).toBe(true);
    const result = readGraveBytes(image, dummyGrave);
    expect(result.ok).toBe(false);
  });
});
