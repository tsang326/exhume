export const ConversionWarningCode = {
  InputTruncated: 'input-truncated',
  OutputCapped: 'output-capped',
  LimitExceeded: 'limit-exceeded',
  WarningsCapped: 'warnings-capped',
  ControlCodesDropped: 'control-codes-dropped',
  DotCommandsIgnored: 'dot-commands-ignored',
  RecordLengthMismatch: 'record-length-mismatch',
  FieldTypeUnknown: 'field-type-unknown',
  RecordsTruncated: 'records-truncated',
  RecordLimit: 'record-limit',
  DeletedRecordsSkipped: 'deleted-records-skipped',
  RecordFlagUnknown: 'record-flag-unknown',
  FieldValueInvalid: 'field-value-invalid',
  MemoNotAvailable: 'memo-not-available',
  PcxDataTruncated: 'pcx-data-truncated',
  PcxPaletteMissing: 'pcx-palette-missing',
} as const;
export type ConversionWarningCode =
  (typeof ConversionWarningCode)[keyof typeof ConversionWarningCode];

export interface ConversionWarning {
  code: ConversionWarningCode;
  message: string;
}

export type OutputMime = 'text/markdown' | 'text/csv' | 'image/png';
export type OutputExtension = '.md' | '.csv' | '.png';

export interface ConversionSuccess<
  O extends string | Uint8Array,
  M extends OutputMime,
  E extends OutputExtension,
> {
  ok: true;
  output: O;
  mime: M;
  extension: E;
  warnings: ConversionWarning[];
}

export interface ConversionFailure {
  ok: false;
  error: string;
  warnings: ConversionWarning[];
}

export type MarkdownResult = ConversionSuccess<string, 'text/markdown', '.md'> | ConversionFailure;
export type CsvResult = ConversionSuccess<string, 'text/csv', '.csv'> | ConversionFailure;
export type PngResult = ConversionSuccess<Uint8Array, 'image/png', '.png'> | ConversionFailure;
export type ConversionResult = MarkdownResult | CsvResult | PngResult;

export interface RgbaImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export type DetectedFormat = 'wordstar' | 'dbase' | 'pcx' | 'unknown';
export type DetectSource = 'content' | 'extension' | 'none';
export interface DetectResult {
  format: DetectedFormat;
  source: DetectSource;
}
