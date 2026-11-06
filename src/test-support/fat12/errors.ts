export type FitLimit = 'root-entry-count' | 'data-cluster-count' | 'file-name-format';

/** Thrown by the writer, before any byte is written, when a tree cannot be stored. */
export class FitError extends Error {
  // Explicit fields: erasableSyntaxOnly forbids constructor parameter properties.
  limit: FitLimit;
  limitValue: number;
  requestedValue: number;

  constructor(limit: FitLimit, limitValue: number, requestedValue: number, detail?: string) {
    super(
      `${limit}: requested ${requestedValue}, limit ${limitValue}` +
        (detail === undefined ? '' : ` (${detail})`),
    );
    this.name = 'FitError';
    this.limit = limit;
    this.limitValue = limitValue;
    this.requestedValue = requestedValue;
  }
}
