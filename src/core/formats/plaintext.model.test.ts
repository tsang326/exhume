import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { numRuns } from '../../test-support/runs';
import { plainTextBytesArb } from '../../test-support/formats/arbitraries';
import { plainTextOracle } from '../../test-support/formats/oracles';
import { convertPlainText } from './plaintext';
import { fill, TEMPLATES } from './templates';
import { ConversionWarningCode } from './types';

/** True when the converter agrees with the independent model on output and the dropped-byte warning. */
function matchesModel(bytes: Uint8Array): boolean {
  const r = convertPlainText(bytes);
  if (!r.ok) return false;
  const model = plainTextOracle(bytes);
  if (r.output !== model.text) return false;
  const dropWarnings = r.warnings.filter(
    (x) => x.code === ConversionWarningCode.ControlCodesDropped,
  );
  if (model.dropped === 0) return dropWarnings.length === 0;
  return (
    dropWarnings.length === 1 &&
    dropWarnings[0]!.message === fill(TEMPLATES.controlCodesDropped, model.dropped)
  );
}

describe('plain text against the independent model', () => {
  // Feature: plain-text, Property 1: Plain text matches the independent model
  // **Validates: Requirements 1.1, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 3.11**
  it('matches the model on DOS-style text bytes', () => {
    fc.assert(fc.property(plainTextBytesArb, (bytes) => matchesModel(bytes)), {
      numRuns: numRuns(100),
    });
  });

  it('matches the model on arbitrary bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 600 }), (bytes) => matchesModel(bytes)),
      { numRuns: numRuns(100) },
    );
  });
});
