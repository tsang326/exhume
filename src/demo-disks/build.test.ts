import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES } from '../core/fat12/limits';
import type { FileTree } from '../test-support/fat12/index';
import { buildAllDemoDisks, buildFromPlan, planOf } from './build';
import { DemoBuildError } from './errors';
import { DEMO_DISK_SPECS } from './specs';

const CAPACITY: Record<string, number> = { '360K': 368_640, '720K': 737_280 };

describe('buildAllDemoDisks', () => {
  const first = buildAllDemoDisks();
  const second = buildAllDemoDisks();

  it('returns the three disks in spec order', () => {
    expect(first.map((d) => d.spec.id)).toEqual(DEMO_DISK_SPECS.map((s) => s.id));
  });

  it('is byte-identical across two runs', () => {
    expect(second).toHaveLength(first.length);
    first.forEach((disk, i) => {
      expect(Array.from(second[i]?.image ?? [])).toEqual(Array.from(disk.image));
    });
  });

  it('keeps each image at geometry capacity and within the size limits', () => {
    for (const disk of first) {
      expect(disk.image.length).toBe(CAPACITY[disk.spec.geometry]);
      expect(disk.image.length).toBeLessThanOrEqual(1_474_560);
      expect(disk.image.length).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    }
  });

  it('keeps the total at most 4,423,680 bytes', () => {
    const total = first.reduce((sum, d) => sum + d.image.length, 0);
    expect(total).toBeLessThanOrEqual(4_423_680);
  });
});

describe('buildFromPlan failures', () => {
  it('wraps a writer failure in a DemoBuildError naming the file', () => {
    const spec = DEMO_DISK_SPECS[0];
    if (spec === undefined) throw new Error('no spec');
    const good = planOf(spec.id);
    const tree: FileTree = {
      volumeLabel: spec.label,
      children: [
        {
          kind: 'file',
          name: 'HUGE.BIN',
          content: new Uint8Array(CAPACITY[spec.geometry] + 1),
          modified: { year: 1990, month: 1, day: 1, hour: 0, minute: 0, second: 0 },
        },
      ],
    };
    let caught: unknown;
    try {
      buildFromPlan(spec, { ...good, tree });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DemoBuildError);
    expect((caught as DemoBuildError).diskFile).toBe(spec.fileName);
    expect((caught as DemoBuildError).message.length).toBeGreaterThan(0);
  });
});
