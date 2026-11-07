import { describe, expect, it } from 'vitest';
import { MAX_FILE_OUTPUT_BYTES } from '../fat12';
import * as L from './limits';

describe('limits', () => {
  it('holds every value from Requirement 1 criterion 2', () => {
    expect(L.MAX_CONVERT_INPUT_BYTES).toBe(4_194_304);
    expect(L.DETECT_SAMPLE_BYTES).toBe(4_096);
    expect(L.MAX_WARNINGS).toBe(100);
    expect(L.MAX_MARKDOWN_OUTPUT_BYTES).toBe(8_388_608);
    expect(L.MAX_DBF_FIELDS).toBe(128);
    expect(L.MAX_DBF_RECORDS).toBe(100_000);
    expect(L.MAX_CSV_OUTPUT_BYTES).toBe(16_777_216);
    expect(L.MAX_IMAGE_DIMENSION).toBe(4_096);
    expect(L.MAX_IMAGE_PIXELS).toBe(4_194_304);
    expect(L.MAX_PCX_BYTES_PER_LINE).toBe(4_096);
    expect(L.MAX_PCX_DECODED_BYTES).toBe(16_777_216);
    expect(L.MAX_PNG_BYTES).toBe(16_782_660);
    expect(L.PNG_STORED_BLOCK_MAX).toBe(65_535);
    expect(L.PNG_SIGNATURE_BYTES).toBe(8);
    expect(L.PNG_CHUNK_OVERHEAD_BYTES).toBe(12);
    expect(L.PNG_IHDR_DATA_BYTES).toBe(13);
    expect(L.PNG_STORED_BLOCK_OVERHEAD_BYTES).toBe(5);
    expect(L.PNG_ZLIB_WRAPPER_BYTES).toBe(6);
    expect(L.CONVERT_TIME_BUDGET_MS).toBe(2_000);
  });

  it('sets the text output cap to 8,388,608 bytes, equal to the Markdown cap', () => {
    expect(L.MAX_TEXT_OUTPUT_BYTES).toBe(8_388_608);
    expect(L.MAX_TEXT_OUTPUT_BYTES).toBe(L.MAX_MARKDOWN_OUTPUT_BYTES);
  });

  it('keeps the image pixel cap shape (2048x2048 and 4096x1024 fit, 2049x2048 does not)', () => {
    expect(2048 * 2048).toBeLessThanOrEqual(L.MAX_IMAGE_PIXELS);
    expect(4096 * 1024).toBeLessThanOrEqual(L.MAX_IMAGE_PIXELS);
    expect(2049 * 2048).toBeGreaterThan(L.MAX_IMAGE_PIXELS);
  });

  it('ties the convert input cap to the FAT12 file output cap', () => {
    expect(L.MAX_CONVERT_INPUT_BYTES).toBe(MAX_FILE_OUTPUT_BYTES);
  });

  it('pngBytesForFiltered gives the exact size for small and worst cases', () => {
    // 1x1 RGBA: filtered = 5 bytes, one stored block.
    expect(L.pngBytesForFiltered(5)).toBe(8 + 25 + (12 + 6 + 5 + 5) + 12);
    expect(L.pngBytesForFiltered(L.MAX_IMAGE_PIXELS * 4 + L.MAX_IMAGE_DIMENSION)).toBe(
      L.MAX_PNG_BYTES,
    );
    // One byte past a block boundary adds one block of overhead.
    expect(L.pngBytesForFiltered(L.PNG_STORED_BLOCK_MAX + 1) - L.pngBytesForFiltered(L.PNG_STORED_BLOCK_MAX)).toBe(
      1 + L.PNG_STORED_BLOCK_OVERHEAD_BYTES,
    );
  });
});
