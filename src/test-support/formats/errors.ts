/**
 * Thrown by the fixture writers, parsers and decoder. `field` names the offending
 * description field, or the unsupported feature for the parser and decoder.
 */
export class FixtureError extends Error {
  // Explicit field: erasableSyntaxOnly forbids constructor parameter properties.
  field: string;

  constructor(field: string, detail?: string) {
    super(detail === undefined ? field : `${field}: ${detail}`);
    this.name = 'FixtureError';
    this.field = field;
  }
}
