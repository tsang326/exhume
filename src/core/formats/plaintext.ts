// Plain text to UTF-8 text: a one-pass byte filter followed by a CP437 decode.
// No regular expressions, no recursion; every loop step consumes one input byte.

import { decodeCp437 } from '../fat12';
import { assertUint8Array, guarded, limitInput } from './guard';
import { MAX_TEXT_OUTPUT_BYTES, TEXT_CHUNK_BYTES } from './limits';
import { okResult } from './result';
import { TEMPLATES, fill } from './templates';
import { makeTextSink } from './textsink';
import { ConversionWarningCode } from './types';
import type { TextResult } from './types';
import { makeWarningCollector } from './warnings';

const CR = 0x0d;
const LF = 0x0a;
const TAB = 0x09;
const FF = 0x0c;
const EOF = 0x1a;
const SPACE = 0x20;
const TILDE = 0x7e;
const HIGH = 0x80;

/** Public converter: cap is MAX_TEXT_OUTPUT_BYTES. */
export function convertPlainText(input: Uint8Array): TextResult {
  return runPlainText(input, MAX_TEXT_OUTPUT_BYTES);
}

/** Test seam: same code with a caller-chosen cap (<= MAX_TEXT_OUTPUT_BYTES). */
export function runPlainText(input: Uint8Array, outputCap: number): TextResult {
  assertUint8Array(input);
  const w = makeWarningCollector();
  return guarded(() => convert(limitInput(input, w), outputCap, w), w);
}

function convert(
  input: Uint8Array,
  outputCap: number,
  w: ReturnType<typeof makeWarningCollector>,
): TextResult {
  const n = input.length;
  const sink = makeTextSink();
  const scratch = new Uint8Array(TEXT_CHUNK_BYTES);
  let used = 0;
  let dropped = 0;
  let lastWasCr = false;
  let capped = false;

  /** Decode the scratch bytes and append them; a short append means the cap was hit. */
  function flush(): void {
    if (used === 0) return;
    const text = decodeCp437(scratch.subarray(0, used));
    used = 0;
    if (sink.pushStringCapped(text, outputCap) < text.length) capped = true;
  }

  function emit(b: number): void {
    if (used === TEXT_CHUNK_BYTES) flush();
    scratch[used++] = b;
  }

  for (let i = 0; i < n && !capped; i++) {
    const b = input[i];
    if (b === EOF) break;
    if (b === CR) {
      emit(LF);
      lastWasCr = true;
      continue;
    }
    // Any byte other than CR clears the CR state, including a dropped control byte.
    const afterCr = lastWasCr;
    lastWasCr = false;
    if (b === LF) {
      if (!afterCr) emit(LF);
    } else if (b === TAB || b === FF || (b >= SPACE && b <= TILDE) || b >= HIGH) {
      emit(b);
    } else {
      dropped++;
    }
  }
  if (!capped) flush();

  if (dropped > 0) {
    w.add(ConversionWarningCode.ControlCodesDropped, fill(TEMPLATES.controlCodesDropped, dropped));
  }
  if (capped) {
    w.add(ConversionWarningCode.OutputCapped, fill(TEMPLATES.outputCappedText, outputCap));
  }
  return okResult(sink.finish(), 'text/plain', '.txt', w);
}
