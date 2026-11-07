// Result-contract checker for the format converters (Property 1).
// Returns a list of violation strings; an empty list means the contract holds.
// Imports only the limit constants and the template table from src/core/formats.
// No vitest, no fast-check, no Node module. Not exported from the barrel.

import {
  MAX_CSV_OUTPUT_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_MARKDOWN_OUTPUT_BYTES,
  MAX_PNG_BYTES,
  MAX_TEXT_OUTPUT_BYTES,
  MAX_WARNINGS,
} from '../../core/formats/limits';
import { LIMIT_EXCEEDED_TEMPLATES, TEMPLATES } from '../../core/formats/templates';

const MIME_EXTENSION: Readonly<Record<string, string>> = {
  'text/markdown': '.md',
  'text/csv': '.csv',
  'text/plain': '.txt',
  'image/png': '.png',
};

const WARNING_CODES: ReadonlySet<string> = new Set([
  'input-truncated',
  'output-capped',
  'limit-exceeded',
  'warnings-capped',
  'control-codes-dropped',
  'dot-commands-ignored',
  'record-length-mismatch',
  'field-type-unknown',
  'records-truncated',
  'record-limit',
  'deleted-records-skipped',
  'record-flag-unknown',
  'field-value-invalid',
  'memo-not-available',
  'pcx-data-truncated',
  'pcx-palette-missing',
]);

const MAX_MESSAGE = 200;
const MAX_SHAPE_DEPTH = 8;

/** Collapses every run of ASCII digits to '#'. */
export function digitSkeleton(s: string): string {
  let out = '';
  let inDigits = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x30 && c <= 0x39) {
      if (!inDigits) out += '#';
      inDigits = true;
    } else {
      inDigits = false;
      out += s.charAt(i);
    }
  }
  return out;
}

function templateSkeleton(template: string): string {
  let filled = template;
  for (let k = 0; k < 4; k++) filled = filled.split('{' + String(k) + '}').join('0');
  return digitSkeleton(filled);
}

const KNOWN_SKELETONS: ReadonlySet<string> = new Set([
  ...Object.values(TEMPLATES).map(templateSkeleton),
  ...Object.values(LIMIT_EXCEEDED_TEMPLATES).map(templateSkeleton),
]);

/** True when the message equals a known template once digit runs are collapsed. */
export function isKnownMessage(message: string): boolean {
  return KNOWN_SKELETONS.has(digitSkeleton(message));
}

/** UTF-8 length of a JavaScript string; a lone surrogate counts as 3 bytes (U+FFFD). */
export function utf8ByteLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4;
        i++;
      } else n += 3;
    } else n += 3;
  }
  return n;
}

function isUint8Array(x: unknown): x is Uint8Array {
  return Object.prototype.toString.call(x) === '[object Uint8Array]';
}

function isPlainObject(x: unknown): boolean {
  if (typeof x !== 'object' || x === null) return false;
  const proto: unknown = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

/** JSON-shape check: strings, numbers, booleans, null, arrays, plain objects, Uint8Array. */
function checkShape(value: unknown, path: string, depth: number, out: string[]): void {
  if (depth > MAX_SHAPE_DEPTH) {
    out.push(`${path}: nesting deeper than ${MAX_SHAPE_DEPTH}`);
    return;
  }
  if (value === null) return;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return;
    case 'number':
      if (!Number.isFinite(value)) out.push(`${path}: non-finite number`);
      return;
    case 'object':
      break;
    default:
      out.push(`${path}: forbidden value of type ${typeof value}`);
      return;
  }
  if (isUint8Array(value)) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => checkShape(v, `${path}[${i}]`, depth + 1, out));
    return;
  }
  if (!isPlainObject(value)) {
    out.push(`${path}: not a plain object`);
    return;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    checkShape((value as Record<string, unknown>)[key], `${path}.${key}`, depth + 1, out);
  }
}

function checkMessage(label: string, message: unknown, out: string[]): void {
  if (typeof message !== 'string') {
    out.push(`${label}: not a string`);
    return;
  }
  if (message.length < 1 || message.length > MAX_MESSAGE) {
    out.push(`${label}: length ${message.length} outside 1..${MAX_MESSAGE}`);
  }
  if (!isKnownMessage(message)) out.push(`${label}: not a known template skeleton`);
}

function checkPng(bytes: Uint8Array, out: string[]): void {
  if (bytes.length > MAX_PNG_BYTES) out.push(`png: ${bytes.length} bytes exceeds MAX_PNG_BYTES`);
  if (bytes.length < 24) {
    out.push(`png: ${bytes.length} bytes is too short to hold an IHDR`);
    return;
  }
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (signature.some((b, i) => bytes[i] !== b)) out.push('png: bad signature');
  const type = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (type !== 'IHDR') out.push('png: first chunk is not IHDR');
  const be32 = (o: number) => bytes[o] * 0x1000000 + bytes[o + 1] * 0x10000 + bytes[o + 2] * 0x100 + bytes[o + 3];
  const width = be32(16);
  const height = be32(20);
  if (width < 1 || width > MAX_IMAGE_DIMENSION) out.push(`png: width ${width} outside 1..MAX_IMAGE_DIMENSION`);
  if (height < 1 || height > MAX_IMAGE_DIMENSION) out.push(`png: height ${height} outside 1..MAX_IMAGE_DIMENSION`);
}

/** Checks one conversion result against the result contract; returns the violations. */
export function checkResultInvariants(result: unknown): string[] {
  const out: string[] = [];
  if (!isPlainObject(result)) return ['result is not a plain object'];
  const r = result as Record<string, unknown>;

  checkShape(r, 'result', 0, out);

  // warnings
  const warnings = r.warnings;
  if (!Array.isArray(warnings)) {
    out.push('warnings is not an array');
  } else {
    if (warnings.length > MAX_WARNINGS + 1) out.push(`warnings has ${warnings.length} entries, above MAX_WARNINGS + 1`);
    warnings.forEach((w: unknown, i) => {
      if (!isPlainObject(w)) {
        out.push(`warnings[${i}] is not a plain object`);
        return;
      }
      const code = (w as Record<string, unknown>).code;
      if (typeof code !== 'string' || !WARNING_CODES.has(code)) out.push(`warnings[${i}].code is not a known code`);
      checkMessage(`warnings[${i}].message`, (w as Record<string, unknown>).message, out);
    });
    const capped = warnings.filter((w: unknown) => isPlainObject(w) && (w as Record<string, unknown>).code === 'warnings-capped');
    if (capped.length > 1) out.push('more than one warnings-capped warning');
    if (capped.length === 1 && warnings[warnings.length - 1] !== capped[0]) out.push('warnings-capped is not the last warning');
  }

  if (r.ok === false) {
    checkMessage('error', r.error, out);
    if ('output' in r) out.push('failure result carries an output');
    return out;
  }
  if (r.ok !== true) {
    out.push('ok is not a boolean');
    return out;
  }

  // success
  const mime = r.mime;
  const extension = r.extension;
  if (typeof mime !== 'string' || !(mime in MIME_EXTENSION)) {
    out.push(`mime ${String(mime)} is not text/markdown, text/csv, text/plain or image/png`);
    return out;
  }
  if (extension !== MIME_EXTENSION[mime]) out.push(`extension ${String(extension)} does not match mime ${mime}`);

  const output = r.output;
  if (mime === 'image/png') {
    if (!isUint8Array(output)) out.push('png output is not a Uint8Array');
    else checkPng(output, out);
    return out;
  }
  if (typeof output !== 'string') {
    out.push(`${mime} output is not a string`);
    return out;
  }
  if (output.includes('\u0000')) out.push(`${mime} output contains a NUL character`);
  let cap: number;
  switch (mime) {
    case 'text/markdown':
      cap = MAX_MARKDOWN_OUTPUT_BYTES;
      break;
    case 'text/plain':
      cap = MAX_TEXT_OUTPUT_BYTES;
      break;
    default:
      cap = MAX_CSV_OUTPUT_BYTES;
  }
  const bytes = utf8ByteLength(output);
  if (bytes > cap) out.push(`${mime} output is ${bytes} UTF-8 bytes, above its cap`);
  return out;
}
