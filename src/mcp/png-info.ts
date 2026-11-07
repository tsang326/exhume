// Width and height of an encoded PNG, read from the IHDR chunk. No pixel data is returned.

import { PNG_HEIGHT_OFFSET, PNG_MIN_BYTES, PNG_WIDTH_OFFSET } from './limits';
import type { Outcome } from './errors';

export interface PngInfo {
  width: number;
  height: number;
}

export function readPngInfo(bytes: Uint8Array): Outcome<PngInfo> {
  if (bytes.length < PNG_MIN_BYTES) return { ok: false, code: 'CONVERSION_FAILED' };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    ok: true,
    value: {
      width: view.getUint32(PNG_WIDTH_OFFSET, false),
      height: view.getUint32(PNG_HEIGHT_OFFSET, false),
    },
  };
}
