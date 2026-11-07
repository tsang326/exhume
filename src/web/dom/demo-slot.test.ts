import { describe, expect, it } from 'vitest';
import { DEMO_LOADING_MESSAGE, runDemo } from './demo-slot';
import type { DemoDisk, DemoLoad } from '../demos';

const demo: DemoDisk = { id: 'a', title: 'A', description: 'Disk A', url: '/disks/a.img' };

function harness(result: DemoLoad | 'throw') {
  const log: string[] = [];
  const got: Uint8Array[] = [];
  const deps = {
    load: async (): Promise<DemoLoad> => {
      log.push('load');
      if (result === 'throw') throw new Error('x');
      return result;
    },
    onBytes: (b: Uint8Array) => {
      got.push(b);
    },
    setBusy: (b: boolean) => log.push(b ? 'busy' : 'idle'),
    setStatus: (t: string) => log.push(`status:${t}`),
  };
  return { deps, log, got };
}

describe('runDemo', () => {
  it('disables, shows loading, then hands bytes on success', async () => {
    const h = harness({ ok: true, bytes: new Uint8Array([1, 2]) });
    await runDemo(demo, h.deps);
    expect(h.log).toEqual(['busy', `status:${DEMO_LOADING_MESSAGE}`, 'load', 'idle', 'status:']);
    expect(h.got).toHaveLength(1);
  });

  it('shows the message and re-enables on failure without calling onBytes', async () => {
    const h = harness({ ok: false, reason: 'http', message: 'nope' });
    await runDemo(demo, h.deps);
    expect(h.log.slice(-2)).toEqual(['idle', 'status:nope']);
    expect(h.got).toHaveLength(0);
  });

  it('treats a thrown load as a failure', async () => {
    const h = harness('throw');
    await runDemo(demo, h.deps);
    expect(h.log).toContain('idle');
    expect(h.got).toHaveLength(0);
  });
});
