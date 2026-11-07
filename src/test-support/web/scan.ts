// Source scanners for the Graveyard_UI (Req 1.5, 1.6, 1.7, 2.4, 3.1, 3.2, 13.2,
// 13.4 to 13.7, 15.1 to 15.4).
//
// This file is the ONLY place that spells out the HTML sink names, the network
// API names and the forbidden phrases. It lives under src/test-support, so it is
// not a Web_Source and the scans do not match themselves.
//
// Text scans (sinks, network, storage, style) do not skip comments or string
// literals, so the rule stays simple. The phrase scan is the opposite: it reads
// only string and template literals (via `extractLiterals`) and the visible text
// of index.html, and ignores code comments.
//
// DOCUMENTED LIMITATION of `extractLiterals`: regex literals are not
// recognised. A `/` is always treated as division, so a regex literal that
// contains a quote or a `//` can be mis-tokenized. The Web_Sources avoid regex
// literals over disk text; this scan is a guard against accidental claims in
// user-visible strings, not a parser.
import { posix } from 'node:path';
import ts from 'typescript';
import { lineOf, parse, walk } from '../scan';

// ------------------------------------------------------------------- types

/** One finding. `line` is 1-based. */
export interface Violation {
  file: string;
  line: number;
  name: string;
}

/** A file to scan: repo-relative POSIX path plus its text. */
export interface SourceFile {
  file: string;
  source: string;
}

export function formatViolation(v: Violation): string {
  return `${v.file}:${v.line} ${v.name}`;
}

export function formatViolations(vs: readonly Violation[]): string {
  return vs.map(formatViolation).join('\n');
}

// ------------------------------------------------------------------- names

/** Names reported by `scanSinks`, one per HTML_Sink of the glossary. */
export const HTML_SINK_NAMES: readonly string[] = [
  'innerHTML',
  'outerHTML',
  'insertAdjacentHTML',
  'document.write',
  'document.writeln',
  'DOMParser',
  'createContextualFragment',
  'srcdoc',
  'setHTML',
  'eval',
  'new Function',
  "setAttribute('on*')",
  "setAttribute('style')",
];

export const DEMOS_FILE = 'src/web/demos.ts';

export const NETWORK_NAMES: readonly string[] = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'sendBeacon',
  'gtag',
  'mixpanel',
  'Sentry',
];

export const STORAGE_NAMES: readonly string[] = [
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'document.cookie',
  'cookieStore',
];

export const FORBIDDEN_PHRASES: readonly string[] = [
  'first browser',
  "world's first",
  'worlds first',
  'the first',
  'first ever',
  'first-ever',
  'only browser',
  'the only',
];

/** The only core modules a Web_Source may import (resolved, no extension). */
export const ALLOWED_CORE_TARGETS: readonly string[] = [
  'src/core/fat12/index',
  'src/core/formats/index',
];

export const MAIN_THREAD_FORBIDDEN_IMPORTS: readonly string[] = [
  'openDisk',
  'readDisk',
  'convertAuto',
  'convertWordStar',
  'convertDBase',
  'convertPcx',
  'encodePng',
];

export const DOM_GLOBAL_NAMES: readonly string[] = [
  'document',
  'window',
  'navigator',
  'HTMLElement',
  'HTMLCanvasElement',
  'HTMLImageElement',
  'HTMLInputElement',
  'HTMLButtonElement',
  'HTMLAnchorElement',
  'HTMLDivElement',
  'KeyboardEvent',
  'MouseEvent',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'matchMedia',
  'getComputedStyle',
];

// ----------------------------------------------------------- text helpers

function isIdentChar(ch: string): boolean {
  return (
    (ch >= 'a' && ch <= 'z') ||
    (ch >= 'A' && ch <= 'Z') ||
    (ch >= '0' && ch <= '9') ||
    ch === '_' ||
    ch === '$'
  );
}

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

/** 1-based line lookup for offsets of one source text. */
function makeLineLookup(source: string): (index: number) => number {
  const starts: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charAt(i) === '\n') starts.push(i + 1);
  }
  return (index: number): number => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((starts[mid] as number) <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** Offsets where `name` occurs with identifier boundaries on identifier edges. */
function findName(source: string, name: string): number[] {
  const out: number[] = [];
  const needLeft = isIdentChar(name.charAt(0));
  const needRight = isIdentChar(name.charAt(name.length - 1));
  let from = 0;
  for (;;) {
    const at = source.indexOf(name, from);
    if (at < 0) break;
    from = at + 1;
    if (needLeft && at > 0 && isIdentChar(source.charAt(at - 1))) continue;
    const end = at + name.length;
    if (needRight && end < source.length && isIdentChar(source.charAt(end))) continue;
    out.push(at);
  }
  return out;
}

interface CallWithString {
  index: number;
  arg: string;
}

/** `callee ( 'literal'` occurrences (single, double or backtick quotes). */
function callsWithStringArg(source: string, callee: string): CallWithString[] {
  const out: CallWithString[] = [];
  for (const at of findName(source, callee)) {
    let i = at + callee.length;
    while (i < source.length && isSpace(source.charAt(i))) i++;
    if (source.charAt(i) !== '(') continue;
    i++;
    while (i < source.length && isSpace(source.charAt(i))) i++;
    const quote = source.charAt(i);
    if (quote !== "'" && quote !== '"' && quote !== '`') continue;
    const close = source.indexOf(quote, i + 1);
    if (close < 0) continue;
    out.push({ index: at, arg: source.slice(i + 1, close) });
  }
  return out;
}

function findNewFunction(source: string): number[] {
  const out: number[] = [];
  for (const at of findName(source, 'new')) {
    let i = at + 3;
    if (!isSpace(source.charAt(i))) continue;
    while (i < source.length && isSpace(source.charAt(i))) i++;
    if (!source.startsWith('Function', i)) continue;
    if (isIdentChar(source.charAt(i + 8))) continue;
    out.push(at);
  }
  return out;
}

function collect(
  file: string,
  source: string,
  name: string,
  offsets: readonly number[],
  into: Violation[],
): void {
  if (offsets.length === 0) return;
  const lineAt = makeLineLookup(source);
  for (const at of offsets) into.push({ file, line: lineAt(at), name });
}

// ------------------------------------------------------------- sink scan

/** HTML sink names (Req 1.5): comments and strings are NOT skipped. */
export function scanSinks(file: string, source: string): Violation[] {
  const out: Violation[] = [];
  for (const name of HTML_SINK_NAMES) {
    if (name === 'new Function') {
      collect(file, source, name, findNewFunction(source), out);
    } else if (name === "setAttribute('on*')" || name === "setAttribute('style')") {
      const hits = callsWithStringArg(source, 'setAttribute')
        .filter((c) =>
          name === "setAttribute('style')"
            ? c.arg.toLowerCase() === 'style'
            : c.arg.toLowerCase().startsWith('on'),
        )
        .map((c) => c.index);
      collect(file, source, name, hits, out);
    } else {
      collect(file, source, name, findName(source, name), out);
    }
  }
  return sortViolations(out);
}

function sortViolations(vs: Violation[]): Violation[] {
  return vs.sort((a, b) => a.line - b.line || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// ---------------------------------------------------------- network scan

/** Network API names found in one file (every name, comments included). */
export function findNetworkNames(file: string, source: string): Violation[] {
  const out: Violation[] = [];
  for (const name of NETWORK_NAMES) collect(file, source, name, findName(source, name), out);
  return sortViolations(out);
}

/**
 * Network scan with the allow-list rule (Req 13.2, 13.5): `fetch` is accepted
 * only in src/web/demos.ts, and only while the allow-list is exactly that one
 * file. Any network name in another file, an allow-list of two or more files
 * (or anything but demos.ts), and any name other than `fetch` in demos.ts is a
 * violation. An allow-list violation has the allow-list text as `file`, line 1.
 */
export function scanNetwork(
  files: readonly SourceFile[],
  allowList: readonly string[] = [DEMOS_FILE],
): Violation[] {
  const out: Violation[] = [];
  if (allowList.length !== 1 || allowList[0] !== DEMOS_FILE) {
    out.push({ file: allowList.join(', ') || '(empty)', line: 1, name: 'allow-list' });
  }
  for (const f of files) {
    const allowed = allowList.length === 1 && allowList[0] === DEMOS_FILE && f.file === DEMOS_FILE;
    for (const v of findNetworkNames(f.file, f.source)) {
      if (allowed && v.name === 'fetch') continue;
      out.push(v);
    }
  }
  return out;
}

// ---------------------------------------------------------- storage scan

/** Storage and cookie names (Req 13.7), in every file. */
export function scanStorage(file: string, source: string): Violation[] {
  const out: Violation[] = [];
  for (const name of STORAGE_NAMES) collect(file, source, name, findName(source, name), out);
  return sortViolations(out);
}

// ------------------------------------------------------------ style scan

/** `.style.`, `cssText`, `createElement('style')`, `setAttribute('style'` (Req 2.4). */
export function scanStyleUse(file: string, source: string): Violation[] {
  const out: Violation[] = [];
  const dotStyle: number[] = [];
  for (let from = source.indexOf('.style.'); from >= 0; from = source.indexOf('.style.', from + 1)) {
    dotStyle.push(from);
  }
  collect(file, source, '.style.', dotStyle, out);
  collect(file, source, 'cssText', findName(source, 'cssText'), out);
  collect(
    file,
    source,
    "createElement('style')",
    callsWithStringArg(source, 'createElement')
      .filter((c) => c.arg.toLowerCase() === 'style')
      .map((c) => c.index),
    out,
  );
  collect(
    file,
    source,
    "setAttribute('style'",
    callsWithStringArg(source, 'setAttribute')
      .filter((c) => c.arg.toLowerCase() === 'style')
      .map((c) => c.index),
    out,
  );
  return sortViolations(out);
}

// ----------------------------------------------------------- phrase scan

export interface Literal {
  text: string;
  line: number;
}

function decodeEscape(ch: string): string {
  return ch === 'n' || ch === 't' || ch === 'r' ? ' ' : ch;
}

/**
 * Single forward pass over TypeScript/JavaScript source; returns the text of
 * every string literal and every template text part with the 1-based line where
 * it starts. States: code, line comment, block comment, single, double and
 * template. `${` opens an expression tokenized as code again, tracked with a
 * stack of brace depths. In a quoted literal a backslash skips the next
 * character; an unescaped newline ends an unterminated quote literal. Comment
 * markers inside literals and quotes inside comments are inert. Regex literals
 * are not recognised (see the header).
 */
export function extractLiterals(source: string): Literal[] {
  type State = 'code' | 'line' | 'block' | 'single' | 'double' | 'template';
  const out: Literal[] = [];
  const stack: number[] = [];
  let state: State = 'code';
  let line = 1;
  let startLine = 1;
  let buf = '';
  let i = 0;
  const n = source.length;

  const flush = (): void => {
    if (buf.length > 0) out.push({ text: buf, line: startLine });
    buf = '';
  };

  while (i < n) {
    const c = source.charAt(i);
    const d = source.charAt(i + 1);
    switch (state) {
      case 'code': {
        if (c === '\n') {
          line++;
          i++;
        } else if (c === '/' && d === '/') {
          state = 'line';
          i += 2;
        } else if (c === '/' && d === '*') {
          state = 'block';
          i += 2;
        } else if (c === "'" || c === '"') {
          state = c === "'" ? 'single' : 'double';
          startLine = line;
          buf = '';
          i++;
        } else if (c === '`') {
          state = 'template';
          startLine = line;
          buf = '';
          i++;
        } else if (c === '{') {
          if (stack.length > 0) stack[stack.length - 1] = (stack[stack.length - 1] as number) + 1;
          i++;
        } else if (c === '}') {
          if (stack.length > 0) {
            if ((stack[stack.length - 1] as number) === 0) {
              stack.pop();
              state = 'template';
              startLine = line;
              buf = '';
            } else {
              stack[stack.length - 1] = (stack[stack.length - 1] as number) - 1;
            }
          }
          i++;
        } else {
          i++;
        }
        break;
      }
      case 'line': {
        if (c === '\n') state = 'code';
        else i++;
        break;
      }
      case 'block': {
        if (c === '*' && d === '/') {
          state = 'code';
          i += 2;
        } else {
          if (c === '\n') line++;
          i++;
        }
        break;
      }
      case 'single':
      case 'double': {
        const quote = state === 'single' ? "'" : '"';
        if (c === '\\') {
          if (d === '\n') {
            line++;
            buf += '\n';
          } else if (d !== '') {
            buf += decodeEscape(d);
          }
          i += 2;
        } else if (c === quote) {
          flush();
          state = 'code';
          i++;
        } else if (c === '\n') {
          flush();
          state = 'code';
        } else {
          buf += c;
          i++;
        }
        break;
      }
      case 'template': {
        if (c === '\\') {
          if (d === '\n') {
            line++;
            buf += '\n';
          } else if (d !== '') {
            buf += decodeEscape(d);
          }
          i += 2;
        } else if (c === '`') {
          flush();
          state = 'code';
          i++;
        } else if (c === '$' && d === '{') {
          flush();
          stack.push(0);
          state = 'code';
          i += 2;
        } else {
          if (c === '\n') line++;
          buf += c;
          i++;
        }
        break;
      }
    }
  }
  if (state === 'single' || state === 'double' || state === 'template') flush();
  return out;
}

function phraseHits(text: string): Array<{ phrase: string; offset: number }> {
  const lower = text.toLowerCase();
  const out: Array<{ phrase: string; offset: number }> = [];
  for (const phrase of FORBIDDEN_PHRASES) {
    for (let at = lower.indexOf(phrase); at >= 0; at = lower.indexOf(phrase, at + 1)) {
      out.push({ phrase, offset: at });
    }
  }
  return out;
}

function countNewlines(text: string, end: number): number {
  let n = 0;
  for (let i = 0; i < end; i++) if (text.charAt(i) === '\n') n++;
  return n;
}

/** Forbidden phrases in string and template literals (Req 13.4, 13.6). */
export function scanPhrasesInSource(file: string, source: string): Violation[] {
  const out: Violation[] = [];
  for (const lit of extractLiterals(source)) {
    for (const hit of phraseHits(lit.text)) {
      out.push({ file, line: lit.line + countNewlines(lit.text, hit.offset), name: hit.phrase });
    }
  }
  return sortViolations(out);
}

/**
 * The visible text of an HTML document: tags, comments and the contents of
 * script and style elements are replaced by spaces. Newlines are kept, so the
 * result has the same line structure as the input.
 */
export function htmlVisibleText(html: string): string {
  const lower = html.toLowerCase();
  const n = html.length;
  let out = '';
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) out += html.charAt(k) === '\n' ? '\n' : ' ';
  };
  let i = 0;
  while (i < n) {
    const c = html.charAt(i);
    if (c !== '<') {
      out += c;
      i++;
      continue;
    }
    if (lower.startsWith('<!--', i)) {
      const close = lower.indexOf('-->', i + 4);
      const end = close < 0 ? n : close + 3;
      blank(i, end);
      i = end;
      continue;
    }
    const next = html.charAt(i + 1);
    const isTag = next === '/' || next === '!' || next === '?' || /[A-Za-z]/.test(next);
    if (!isTag) {
      out += c;
      i++;
      continue;
    }
    // Read the tag name, then scan to the closing '>' honouring quotes.
    let j = i + 1;
    const closing = html.charAt(j) === '/';
    if (closing) j++;
    let nameEnd = j;
    while (nameEnd < n && isIdentChar(html.charAt(nameEnd))) nameEnd++;
    const tagName = lower.slice(j, nameEnd);
    let quote = '';
    let k = nameEnd;
    while (k < n) {
      const ch = html.charAt(k);
      if (quote) {
        if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      }
      k++;
    }
    let end = Math.min(k + 1, n);
    if (!closing && (tagName === 'script' || tagName === 'style')) {
      const closeAt = lower.indexOf(`</${tagName}`, end);
      if (closeAt < 0) {
        end = n;
      } else {
        const gt = lower.indexOf('>', closeAt);
        end = gt < 0 ? n : gt + 1;
      }
    }
    blank(i, end);
    // blank() wrote spaces, so words on either side of a tag do not fuse.
    i = end;
  }
  return out;
}

/** Forbidden phrases in the visible text of an HTML file. */
export function scanPhrasesInHtml(file: string, html: string): Violation[] {
  const text = htmlVisibleText(html);
  const out: Violation[] = [];
  for (const hit of phraseHits(text)) {
    out.push({ file, line: 1 + countNewlines(text, hit.offset), name: hit.phrase });
  }
  return sortViolations(out);
}

// ------------------------------------------------------ src / alt scan

const SET_SRC_BLOB_FILE = 'src/web/dom/h.ts';

function isSrcAltName(s: string): boolean {
  return s === 'src' || s === 'alt';
}

/**
 * `.src`, `.alt`, `'src'`, `'alt'` and `setAttribute('src'|'alt')` (Req 1.3).
 * In `src/web/dom/h.ts` the body of `setSrcBlob` is exempt; everywhere else
 * every occurrence is a violation. Comments are not code and never match.
 */
export function scanSrcAlt(file: string, source: string): Violation[] {
  const sf = parse(source, file);
  const out: Violation[] = [];
  const exempt = (n: ts.Node): boolean => {
    if (file !== SET_SRC_BLOB_FILE) return false;
    for (let p: ts.Node | undefined = n; p; p = p.parent) {
      if (ts.isFunctionDeclaration(p) && p.name?.text === 'setSrcBlob') return true;
      if (
        ts.isVariableDeclaration(p) &&
        ts.isIdentifier(p.name) &&
        p.name.text === 'setSrcBlob'
      ) {
        return true;
      }
    }
    return false;
  };
  walk(sf, (n) => {
    if (exempt(n)) return;
    if (ts.isPropertyAccessExpression(n) && isSrcAltName(n.name.text)) {
      out.push({ file, line: lineOf(sf, n.name), name: `.${n.name.text}` });
    } else if (ts.isStringLiteralLike(n) && isSrcAltName(n.text)) {
      const p = n.parent;
      if (
        ts.isCallExpression(p) &&
        p.arguments[0] === n &&
        ((ts.isPropertyAccessExpression(p.expression) && p.expression.name.text === 'setAttribute') ||
          (ts.isIdentifier(p.expression) && p.expression.text === 'setAttribute'))
      ) {
        out.push({ file, line: lineOf(sf, n), name: `setAttribute('${n.text}')` });
      } else {
        out.push({ file, line: lineOf(sf, n), name: `'${n.text}'` });
      }
    }
  });
  return sortViolations(out);
}

// --------------------------------------------------------- import scans

interface SpecifierRef {
  specifier: string;
  line: number;
}

/** Static imports and re-exports (including `import type`), dynamic `import()`, `require`, import types and `new URL('x', ...)`. */
export function importSpecifiers(file: string, source: string): SpecifierRef[] {
  const sf = parse(source, file);
  const out: SpecifierRef[] = [];
  walk(sf, (n) => {
    if (
      (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
      n.moduleSpecifier &&
      ts.isStringLiteralLike(n.moduleSpecifier)
    ) {
      out.push({ specifier: n.moduleSpecifier.text, line: lineOf(sf, n) });
    } else if (
      ts.isImportEqualsDeclaration(n) &&
      ts.isExternalModuleReference(n.moduleReference) &&
      ts.isStringLiteralLike(n.moduleReference.expression)
    ) {
      out.push({ specifier: n.moduleReference.expression.text, line: lineOf(sf, n) });
    } else if (
      ts.isImportTypeNode(n) &&
      ts.isLiteralTypeNode(n.argument) &&
      ts.isStringLiteralLike(n.argument.literal)
    ) {
      out.push({ specifier: n.argument.literal.text, line: lineOf(sf, n) });
    } else if (
      ts.isCallExpression(n) &&
      (n.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(n.expression) && n.expression.text === 'require')) &&
      n.arguments[0] !== undefined &&
      ts.isStringLiteralLike(n.arguments[0])
    ) {
      out.push({ specifier: n.arguments[0].text, line: lineOf(sf, n) });
    } else if (
      ts.isNewExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 'URL' &&
      n.arguments !== undefined &&
      n.arguments[0] !== undefined &&
      ts.isStringLiteralLike(n.arguments[0])
    ) {
      out.push({ specifier: n.arguments[0].text, line: lineOf(sf, n) });
    }
  });
  return out;
}

const EXTENSIONS = ['.d.ts', '.tsx', '.mts', '.cts', '.ts', '.mjs', '.cjs', '.js'];

/**
 * Resolve a specifier to a repo-relative path without extension. Relative
 * specifiers resolve against the importing file; specifiers starting with
 * `src/` are taken as repo-relative; other bare specifiers (packages) give
 * null. Directory form (`../core/fat12`) resolves to its `index`.
 */
export function resolveSpecifier(fromFile: string, specifier: string): string | null {
  let target: string;
  if (specifier.startsWith('./') || specifier.startsWith('../') || specifier === '.' || specifier === '..') {
    target = posix.normalize(posix.join(posix.dirname(fromFile), specifier));
  } else if (specifier.startsWith('src/')) {
    target = posix.normalize(specifier);
  } else {
    return null;
  }
  if (target.endsWith('/')) target = target.slice(0, -1);
  for (const ext of EXTENSIONS) {
    if (target.endsWith(ext)) {
      target = target.slice(0, -ext.length);
      break;
    }
  }
  if (target === 'src/core/fat12' || target === 'src/core/formats' || target === 'src/core') {
    target += '/index';
  }
  return target;
}

/**
 * Core import rule (Req 3.2, 15.4): a specifier that resolves into src/core
 * must resolve to src/core/fat12/index or src/core/formats/index.
 */
export function scanCoreImports(file: string, source: string): Violation[] {
  const out: Violation[] = [];
  for (const ref of importSpecifiers(file, source)) {
    const target = resolveSpecifier(file, ref.specifier);
    if (target === null) continue;
    if (target.startsWith('src/core/') && !ALLOWED_CORE_TARGETS.includes(target)) {
      out.push({ file, line: ref.line, name: ref.specifier });
    }
  }
  return sortViolations(out);
}

/** Main-thread files must not import the reader or converter functions (Req 3.1). */
export function scanMainThreadImports(file: string, source: string): Violation[] {
  const sf = parse(source, file);
  const out: Violation[] = [];
  walk(sf, (n) => {
    if (ts.isImportDeclaration(n)) {
      const bindings = n.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          const imported = (el.propertyName ?? el.name).text;
          if (MAIN_THREAD_FORBIDDEN_IMPORTS.includes(imported)) {
            out.push({ file, line: lineOf(sf, el), name: imported });
          }
        }
      }
    } else if (
      ts.isExportDeclaration(n) &&
      n.moduleSpecifier &&
      n.exportClause &&
      ts.isNamedExports(n.exportClause)
    ) {
      for (const el of n.exportClause.elements) {
        const imported = (el.propertyName ?? el.name).text;
        if (MAIN_THREAD_FORBIDDEN_IMPORTS.includes(imported)) {
          out.push({ file, line: lineOf(sf, el), name: imported });
        }
      }
    }
  });
  return sortViolations(out);
}

// --------------------------------------------------- DOM globals / tests

function isNamePosition(n: ts.Identifier): boolean {
  const p = n.parent;
  if (ts.isPropertyAccessExpression(p) && p.name === n) return true;
  if (ts.isQualifiedName(p) && p.right === n) return true;
  if (
    (ts.isPropertyAssignment(p) ||
      ts.isPropertySignature(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isMethodSignature(p)) &&
    p.name === n
  ) {
    return true;
  }
  return false;
}

/** DOM global names in `logic/` files (Req 15.1); types count, property names do not. */
export function scanDomGlobals(file: string, source: string): Violation[] {
  const sf = parse(source, file);
  const out: Violation[] = [];
  walk(sf, (n) => {
    if (ts.isIdentifier(n) && DOM_GLOBAL_NAMES.includes(n.text) && !isNamePosition(n)) {
      out.push({ file, line: lineOf(sf, n), name: n.text });
    }
  });
  return sortViolations(out);
}

/** `expect(` inside an `fc.property` / `fc.asyncProperty` callback (Req 15.2). */
export function scanExpectInProperty(file: string, source: string): Violation[] {
  const sf = parse(source, file);
  const out: Violation[] = [];
  walk(sf, (n) => {
    if (
      !ts.isCallExpression(n) ||
      !ts.isPropertyAccessExpression(n.expression) ||
      !ts.isIdentifier(n.expression.expression) ||
      n.expression.expression.text !== 'fc' ||
      (n.expression.name.text !== 'property' && n.expression.name.text !== 'asyncProperty')
    ) {
      return;
    }
    for (const arg of n.arguments) {
      if (!ts.isArrowFunction(arg) && !ts.isFunctionExpression(arg)) continue;
      const visit = (m: ts.Node): void => {
        if (ts.isCallExpression(m) && ts.isIdentifier(m.expression) && m.expression.text === 'expect') {
          out.push({ file, line: lineOf(sf, m), name: 'expect(' });
        }
        ts.forEachChild(m, visit);
      };
      visit(arg.body);
    }
  });
  return sortViolations(out);
}
