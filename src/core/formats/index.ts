/** Public API of the format resurrection core. Consumers import only from this module. */

export { convertWordStar } from './wordstar';
export { convertDBase } from './dbase';
export { convertPcx } from './pcx';
export { convertLotus } from './lotus';
export { convertPlainText } from './plaintext';
export { encodePng } from './png';
export { detectFormat } from './detect';
export { convertAuto } from './auto';
export * from './limits';

// Value object whose name is shared with a type of the same name.
export { ConversionWarningCode } from './types';
export type {
  ConversionResult,
  ConversionWarning,
  ConversionSuccess,
  ConversionFailure,
  MarkdownResult,
  CsvResult,
  TextResult,
  PngResult,
  RgbaImage,
  DetectResult,
  DetectedFormat,
  DetectSource,
  OutputMime,
  OutputExtension,
} from './types';
