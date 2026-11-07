/**
 * Demo disk registry and loader.
 *
 * Extension point for spec 5: add entries to DEMO_REGISTRY. This is the only module
 * in the web sources allowed to call the network, and it uses nothing but `fetch`.
 */
import { DEMO_TIMEOUT_MS, MAX_IMAGE_BYTES } from './logic/limits';
import { validateDemoDisk } from './logic/demo-validate';

export interface DemoDisk {
  id: string;
  title: string;
  description: string;
  url: string;
}

/** Empty by default. Spec 5 adds entries here. */
export const DEMO_REGISTRY: readonly DemoDisk[] = [];

export type DemoLoad =
  | { ok: true; bytes: Uint8Array }
  | {
      ok: false;
      reason: 'invalid' | 'network' | 'http' | 'too-large' | 'empty' | 'timeout';
      message: string;
    };

type Fail = Extract<DemoLoad, { ok: false }>;

function fail(reason: Fail['reason'], message: string): Fail {
  return { ok: false, reason, message };
}

const TOO_LARGE = 'The demo disk is larger than the 2.8 MB limit.';
const TIMED_OUT = 'Loading the demo disk took too long (10 seconds).';
const NETWORK = 'The demo disk could not be loaded.';

function declaredLength(response: Response): number | null {
  const raw = response.headers.get('content-length');
  if (raw === null || !/^[0-9]{1,15}$/.test(raw.trim())) return null;
  return Number(raw.trim());
}

async function readBody(response: Response): Promise<DemoLoad> {
  const body = response.body;
  if (body === null || body === undefined) {
    const buf = await response.arrayBuffer();
    if (buf.byteLength > MAX_IMAGE_BYTES) return fail('too-large', TOO_LARGE);
    if (buf.byteLength === 0) return fail('empty', 'The demo disk is empty.');
    return { ok: true, bytes: new Uint8Array(buf) };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    const chunk = step.value;
    total += chunk.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // Ignore: the read is abandoned either way.
      }
      return fail('too-large', TOO_LARGE);
    }
    chunks.push(chunk);
  }
  if (total === 0) return fail('empty', 'The demo disk is empty.');
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return { ok: true, bytes };
}

export async function loadDemoBytes(
  demo: DemoDisk,
  fetchImpl?: typeof fetch,
  timeoutMs: number = DEMO_TIMEOUT_MS,
): Promise<DemoLoad> {
  const check = validateDemoDisk(demo);
  if (!check.ok) return fail('invalid', check.message);

  const doFetch: typeof fetch = fetchImpl ?? ((input, init) => fetch(input, init));
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<DemoLoad>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      resolve(fail('timeout', TIMED_OUT));
    }, timeoutMs);
  });

  const work = (async (): Promise<DemoLoad> => {
    try {
      const response = await doFetch(demo.url, {
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (response.status < 200 || response.status > 299) {
        return fail('http', `The demo disk request failed (status ${response.status}).`);
      }
      const declared = declaredLength(response);
      if (declared !== null && declared > MAX_IMAGE_BYTES) {
        return fail('too-large', TOO_LARGE);
      }
      return await readBody(response);
    } catch {
      return timedOut ? fail('timeout', TIMED_OUT) : fail('network', NETWORK);
    }
  })();

  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
