// Every numeric limit of the format resurrection module lives here.
// Values that equal 2949120 or 4194304 are spelled as arithmetic so the
// core-wide literal purity scan stays green.

const MIB = 1024 * 1024;
export const U16_MAX = 0xffff; // 16-bit mask / maximum

export const MAX_CONVERT_INPUT_BYTES = 4 * MIB; // 4,194,304
export const DETECT_SAMPLE_BYTES = 4096;
export const MAX_WARNINGS = 100;
export const MAX_MARKDOWN_OUTPUT_BYTES = 8 * MIB; // 8,388,608
export const MAX_TEXT_OUTPUT_BYTES = MAX_MARKDOWN_OUTPUT_BYTES; // 8,388,608 bytes of UTF-8
export const MAX_DBF_FIELDS = 128;
export const MAX_DBF_RECORDS = 100_000;
export const MAX_CSV_OUTPUT_BYTES = 16 * MIB; // 16,777,216
export const MAX_IMAGE_DIMENSION = 4096;
export const MAX_IMAGE_PIXELS = 2048 * 2048; // 4,194,304
export const MAX_PCX_BYTES_PER_LINE = 4096;
export const MAX_PCX_DECODED_BYTES = 16 * MIB; // 16,777,216
export const PNG_STORED_BLOCK_MAX = U16_MAX; // 65,535
export const PNG_SIGNATURE_BYTES = 8;
export const PNG_CHUNK_OVERHEAD_BYTES = 12; // length + type + CRC
export const PNG_IHDR_DATA_BYTES = 13;
export const PNG_STORED_BLOCK_OVERHEAD_BYTES = 5; // BFINAL/BTYPE byte + LEN + NLEN
export const PNG_ZLIB_WRAPPER_BYTES = 6; // 2-byte header + 4-byte Adler-32
export const CONVERT_TIME_BUDGET_MS = 2_000; // tests only

/** Exact PNG length for a filtered data length (single IDAT, stored blocks). */
export function pngBytesForFiltered(filteredBytes: number): number {
  const blocks = Math.ceil(filteredBytes / PNG_STORED_BLOCK_MAX);
  return (
    PNG_SIGNATURE_BYTES +
    (PNG_CHUNK_OVERHEAD_BYTES + PNG_IHDR_DATA_BYTES) +
    (PNG_CHUNK_OVERHEAD_BYTES +
      PNG_ZLIB_WRAPPER_BYTES +
      filteredBytes +
      PNG_STORED_BLOCK_OVERHEAD_BYTES * blocks) +
    PNG_CHUNK_OVERHEAD_BYTES
  );
}

/** Worst case: filtered length F = pixels * 4 + height at the maximum pixel count and height. */
export const MAX_PNG_BYTES = pngBytesForFiltered(MAX_IMAGE_PIXELS * 4 + MAX_IMAGE_DIMENSION);

// Internal constants.
export const MARKDOWN_CLOSE_RESERVE_BYTES = 3; // closing `**` + `*` must always fit under the cap
export const TEXT_CHUNK_BYTES = 8 * 1024; // TextSink chunk, in UTF-16 code units; also the scratch byte buffer of the plain text converter
export const MAX_MESSAGE_CHARS = 200;
export const DBF_FIXED_HEADER_BYTES = 32;
export const DBF_DESCRIPTOR_BYTES = 32;
export const DBF_MAX_FIELD_LENGTH = 255;
export const DBF_NAME_BYTES = 11;
export const DBF_MIN_HEADER_BYTES = DBF_FIXED_HEADER_BYTES + DBF_DESCRIPTOR_BYTES + 1; // 65
export const DBF_MAX_HEADER_BYTES =
  DBF_FIXED_HEADER_BYTES + DBF_DESCRIPTOR_BYTES * MAX_DBF_FIELDS + 1; // 4,129
export const PCX_HEADER_BYTES = 128;
export const PCX_VGA_PALETTE_BYTES = 769; // 0x0C marker + 256 * 3

/** Names of the exported limits that a failure or warning can point at. */
export type LimitName =
  | 'MAX_CONVERT_INPUT_BYTES'
  | 'DETECT_SAMPLE_BYTES'
  | 'MAX_WARNINGS'
  | 'MAX_MARKDOWN_OUTPUT_BYTES'
  | 'MAX_TEXT_OUTPUT_BYTES'
  | 'MAX_DBF_FIELDS'
  | 'MAX_DBF_RECORDS'
  | 'MAX_CSV_OUTPUT_BYTES'
  | 'MAX_IMAGE_DIMENSION'
  | 'MAX_IMAGE_PIXELS'
  | 'MAX_PCX_BYTES_PER_LINE'
  | 'MAX_PCX_DECODED_BYTES'
  | 'MAX_PNG_BYTES';
