// Closed table of every warning and error message. Placeholders are {0}, {1}.
// Messages hold numbers only: no input text, file name or field name.

import type { LimitName } from './limits';

export const TEMPLATES = {
  inputTruncated: 'input truncated to {0} bytes (MAX_CONVERT_INPUT_BYTES)',
  outputCappedMarkdown: 'output capped at {0} bytes (MAX_MARKDOWN_OUTPUT_BYTES)',
  outputCappedText: 'output capped at {0} bytes (MAX_TEXT_OUTPUT_BYTES)',
  outputCappedCsv: 'output capped at {0} bytes (MAX_CSV_OUTPUT_BYTES)',
  warningsCapped: 'warnings capped at {0}',
  controlCodesDropped: '{0} control bytes dropped',
  dotCommandsIgnored: '{0} dot command lines ignored',
  recordLengthMismatch: 'record length {0} is larger than the fields need ({1})',
  fieldTypeUnknown: 'field {0} has an unknown type, read as text',
  recordsTruncated: 'declared {0} records, read {1}',
  recordLimit: 'record count above MAX_DBF_RECORDS',
  deletedRecordsSkipped: '{0} deleted records skipped',
  recordFlagUnknown: 'record with an unknown deletion flag read as active',
  fieldValueInvalid: 'field {0} holds an invalid value, written empty',
  memoNotAvailable: 'memo fields are not available, written empty',
  pcxDataTruncated: 'pixel data ended after {0} complete rows',
  pcxPaletteMissing: 'no 256-colour palette found, grayscale used',
  errDbfInvalid: 'dBase header invalid: condition {0}',
  errDbfVersion: 'unsupported dBase version {0}',
  errPcxShort: 'PCX header too short: {0} bytes',
  errPcxLarge: 'PCX image too large: {0}x{1}',
  errPcxFormat: 'PCX format not supported: {0} bits, {1} planes',
  errPcxInvalid: 'PCX header invalid: condition {0}',
  errPngInput: 'PNG input invalid',
  errNoConverter: 'no converter for this format',
  errInternal: 'conversion failed',
} as const;

export type TemplateKey = keyof typeof TEMPLATES;

/** One digit-free template per limit name. */
export const LIMIT_EXCEEDED_TEMPLATES: Readonly<Record<LimitName, string>> = {
  MAX_CONVERT_INPUT_BYTES: 'MAX_CONVERT_INPUT_BYTES exceeded',
  DETECT_SAMPLE_BYTES: 'DETECT_SAMPLE_BYTES exceeded',
  MAX_WARNINGS: 'MAX_WARNINGS exceeded',
  MAX_MARKDOWN_OUTPUT_BYTES: 'MAX_MARKDOWN_OUTPUT_BYTES exceeded',
  MAX_TEXT_OUTPUT_BYTES: 'MAX_TEXT_OUTPUT_BYTES exceeded',
  MAX_DBF_FIELDS: 'MAX_DBF_FIELDS exceeded',
  MAX_DBF_RECORDS: 'MAX_DBF_RECORDS exceeded',
  MAX_CSV_OUTPUT_BYTES: 'MAX_CSV_OUTPUT_BYTES exceeded',
  MAX_IMAGE_DIMENSION: 'MAX_IMAGE_DIMENSION exceeded',
  MAX_IMAGE_PIXELS: 'MAX_IMAGE_PIXELS exceeded',
  MAX_PCX_BYTES_PER_LINE: 'MAX_PCX_BYTES_PER_LINE exceeded',
  MAX_PCX_DECODED_BYTES: 'MAX_PCX_DECODED_BYTES exceeded',
  MAX_PNG_BYTES: 'MAX_PNG_BYTES exceeded',
};

/** Message for a limit-exceeded warning, keyed by limit name. */
export function limitExceededMessage(name: LimitName): string {
  return LIMIT_EXCEEDED_TEMPLATES[name];
}

/**
 * Replace {0}, {1}, ... with the given numbers. Uses split/join only.
 * Each value is substituted once per placeholder, in a single left-to-right pass
 * per index, so a substituted value is never re-scanned as a placeholder
 * (values are numbers, which hold no braces).
 */
export function fill(template: string, ...values: number[]): string {
  let out = template;
  for (let i = 0; i < values.length; i++) {
    out = out.split('{' + String(i) + '}').join(String(values[i]));
  }
  return out;
}
