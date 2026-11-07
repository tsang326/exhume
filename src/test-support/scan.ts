// Static source scanners shared by the purity tests. Sources are parsed with
// the TypeScript compiler API so comments and string contents can never cause
// false matches.
import { builtinModules } from 'node:module';
import ts from 'typescript';

export interface Finding {
  line: number;
  message: string;
}

const BUILTINS = new Set<string>(builtinModules);
const FORBIDDEN_IDENTIFIERS = new Set(['document', 'window', 'fetch', 'eval']);
const FORBIDDEN_LIMITS = new Set([2949120, 4194304]);

export function parse(source: string, fileName = 'x.ts'): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
}

export function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

export function walk(sf: ts.SourceFile, visit: (n: ts.Node) => void): void {
  const rec = (n: ts.Node): void => {
    visit(n);
    ts.forEachChild(n, rec);
  };
  rec(sf);
}

// ---------------------------------------------------------------- scanners

export interface ModuleRef {
  specifier: string;
  line: number;
}

/** Every static import/export-from, import-equals and dynamic import/require. */
export function moduleRefs(sf: ts.SourceFile): ModuleRef[] {
  const out: ModuleRef[] = [];
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
      ts.isCallExpression(n) &&
      (n.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(n.expression) && n.expression.text === 'require')) &&
      n.arguments[0] !== undefined &&
      ts.isStringLiteralLike(n.arguments[0])
    ) {
      out.push({ specifier: n.arguments[0].text, line: lineOf(sf, n) });
    }
  });
  return out;
}

export function isBuiltin(spec: string): boolean {
  const bare = spec.startsWith('node:') ? spec.slice(5) : spec;
  return spec.startsWith('node:') || BUILTINS.has(bare) || BUILTINS.has(bare.split('/')[0] ?? '');
}

export function isRelative(spec: string): boolean {
  return spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..';
}

export function packageName(spec: string): string {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? spec);
}

export function findNodeBuiltinImports(sf: ts.SourceFile): Finding[] {
  return moduleRefs(sf)
    .filter((r) => isBuiltin(r.specifier))
    .map((r) => ({ line: r.line, message: `imports Node built-in '${r.specifier}'` }));
}

export function findNonRelativeImports(sf: ts.SourceFile): Finding[] {
  return moduleRefs(sf)
    .filter((r) => !isRelative(r.specifier))
    .map((r) => ({ line: r.line, message: `non-relative import '${r.specifier}'` }));
}

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

export function findForbiddenGlobals(sf: ts.SourceFile): Finding[] {
  const out: Finding[] = [];
  walk(sf, (n) => {
    if (ts.isIdentifier(n) && FORBIDDEN_IDENTIFIERS.has(n.text) && !isNamePosition(n)) {
      out.push({ line: lineOf(sf, n), message: `references forbidden identifier '${n.text}'` });
    } else if (
      ts.isNewExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 'Function'
    ) {
      out.push({ line: lineOf(sf, n), message: 'uses `new Function`' });
    } else if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 'Function'
    ) {
      out.push({ line: lineOf(sf, n), message: 'calls `Function(...)`' });
    }
  });
  return out;
}

export function findAnyKeyword(sf: ts.SourceFile): Finding[] {
  const out: Finding[] = [];
  walk(sf, (n) => {
    if (n.kind === ts.SyntaxKind.AnyKeyword) {
      out.push({ line: lineOf(sf, n), message: 'uses the `any` type' });
    }
  });
  return out;
}

export function findLimitLiterals(sf: ts.SourceFile): Finding[] {
  const out: Finding[] = [];
  walk(sf, (n) => {
    if (ts.isNumericLiteral(n)) {
      const value = Number(n.text.replace(/_/g, ''));
      if (FORBIDDEN_LIMITS.has(value)) {
        out.push({
          line: lineOf(sf, n),
          message: `duplicates limit literal ${value} (define it only in limits.ts)`,
        });
      }
    }
  });
  return out;
}

export function findRegExp(sf: ts.SourceFile): Finding[] {
  const out: Finding[] = [];
  walk(sf, (n) => {
    if (n.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      out.push({ line: lineOf(sf, n), message: 'uses a RegExp literal' });
    } else if (
      (ts.isNewExpression(n) || ts.isCallExpression(n)) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 'RegExp'
    ) {
      out.push({ line: lineOf(sf, n), message: 'uses RegExp(...)' });
    }
  });
  return out;
}
