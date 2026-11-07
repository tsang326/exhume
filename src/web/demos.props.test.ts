import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { loadDemoBytes, type DemoDisk } from './demos';
import { MAX_IMAGE_BYTES } from './logic/limits';
import { numRuns } from '../test-support/runs';

type NetImpl = NonNullable<Parameters<typeof loadDemoBytes>[1]>;

const demo: DemoDisk = {
  id: 'one',
  title: 'Sample',
  description: 'A sample disk.',
  url: '/disks/sample.img',
};

interface Scenario {
  sizes: number[];
  header: 'none' | 'true' | 'low' | 'high';
}

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  sizes: fc.oneof(
    fc.array(fc.integer({ min: 0, max: 300_000 }), { minLength: 0, maxLength: 8 }),
    fc.array(fc.integer({ min: 0, max: 40_000 }), { minLength: 0, maxLength: 6 }),
    fc.constantFrom<number[][]>([MAX_IMAGE_BYTES], [MAX_IMAGE_BYTES, 1], [MAX_IMAGE_BYTES - 1, 1], [MAX_IMAGE_BYTES - 1, 2]),
  ),
  header: fc.constantFrom('none', 'true', 'low', 'high'),
});

async function runScenario(s: Scenario) {
  const total = s.sizes.reduce((a, b) => a + b, 0);
  let produced = 0;
  let maxProducedBytes = 0;
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < s.sizes.length) {
        const n = s.sizes[i++];
        produced += n;
        maxProducedBytes = Math.max(maxProducedBytes, produced);
        controller.enqueue(new Uint8Array(n));
      } else {
        controller.close();
      }
    },
  });
  const headers = new Headers();
  if (s.header === 'true') headers.set('content-length', String(total));
  if (s.header === 'low') headers.set('content-length', '1');
  if (s.header === 'high') headers.set('content-length', String(MAX_IMAGE_BYTES * 2));
  const response = new Response(body, { status: 200, headers });
  const calls: Array<[unknown, RequestInit | undefined]> = [];
  const impl = (async (input: unknown, init?: RequestInit) => {
    calls.push([input, init]);
    return response;
  }) as unknown as NetImpl;
  const out = await loadDemoBytes(demo, impl);
  return { out, total, calls, maxProducedBytes, chunkMax: Math.max(0, ...s.sizes) };
}

describe('demo loading properties', () => {
  // Feature: graveyard-ui, Property 31: Demo loading never accumulates more than the cap
  it('Property 31: Demo loading never accumulates more than the cap', async () => {
    // **Validates: Requirements 8.12, 8.14**
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (s) => {
        const { out, total, calls, maxProducedBytes, chunkMax } = await runScenario(s);
        if (calls.length !== 1) return false;
        if (calls[0][0] !== demo.url) return false;
        if (calls[0][1]?.credentials !== 'omit') return false;
        // A lying "high" header may reject early; a "low" header must not matter.
        if (s.header === 'high') {
          return !out.ok && out.reason === 'too-large';
        }
        if (total > MAX_IMAGE_BYTES) {
          if (out.ok || out.reason !== 'too-large') return false;
          // Never pulled more than the cap plus one chunk (plus a stream read-ahead chunk).
          return maxProducedBytes <= MAX_IMAGE_BYTES + 2 * chunkMax;
        }
        if (total === 0) return !out.ok && out.reason === 'empty';
        return out.ok && out.bytes.length === total;
      }),
      { numRuns: numRuns(100) },
    );
    expect(true).toBe(true);
  });
});
