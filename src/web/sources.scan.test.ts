// Source scans for the Graveyard_UI (Req 1.5, 1.6, 1.7, 2.4, 3.1, 3.2, 13.2,
// 13.4 to 13.7, 15.1 to 15.4). The first half checks the scanners on fixtures;
// the second half runs them over every Web_Source file that exists.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEMOS_FILE,
  HTML_SINK_NAMES,
  formatViolations,
  scanCoreImports,
  scanDomGlobals,
  scanExpectInProperty,
  scanMainThreadImports,
  scanNetwork,
  scanPhrasesInHtml,
  scanPhrasesInSource,
  scanSinks,
  scanSrcAlt,
  scanStorage,
  scanStyleUse,
  type SourceFile,
  type Violation,
} from '../test-support/web/scan';
import { parseHtml, visibleText } from '../test-support/web/html-scan';

// ------------------------------------------------------------ self-tests

const SINK_FIXTURE = [
  'el.innerHTML = x;',
  'el.outerHTML = x;',
  'el.insertAdjacentHTML(a, b);',
  'document.write(x);',
  'document.writeln(x);',
  'const p = new DOMParser();',
  'range.createContextualFragment(x);',
  'frame.srcdoc = x;',
  'el.setHTML(x);',
  'eval(x);',
  'const f = new Function(x);',
  "el.setAttribute('onclick', x);",
  "el.setAttribute('style', x);",
].join('\n');

const CLEAN_FIXTURE = [
  "const el = document.createElement('div');",
  'el.textContent = label;',
  "el.setAttribute('aria-label', label);",
  'const evaluate = (n: number) => n + 1;',
  'const html = 1; // plain text',
].join('\n');

describe('scan self-tests: sinks', () => {
  it('reports exactly one violation per sink name', () => {
    const found = scanSinks('fixture.ts', SINK_FIXTURE);
    expect(found.map((v) => v.name).sort()).toEqual([...HTML_SINK_NAMES].sort());
  });

  it('reports the line of each sink', () => {
    const found = scanSinks('fixture.ts', SINK_FIXTURE);
    const inner = found.find((v) => v.name === 'innerHTML');
    expect(inner?.line).toBe(1);
    expect(found.find((v) => v.name === "setAttribute('style')")?.line).toBe(13);
  });

  it('reports nothing for a clean fixture', () => {
    expect(scanSinks('clean.ts', CLEAN_FIXTURE)).toEqual([]);
  });
});

describe('scan self-tests: network', () => {
  const fetchSrc: SourceFile = { file: DEMOS_FILE, source: 'const r = await fetch(url);' };

  it('accepts fetch in src/web/demos.ts', () => {
    expect(scanNetwork([fetchSrc])).toEqual([]);
  });

  it('fails for fetch in another file', () => {
    const found = scanNetwork([{ file: 'src/web/other.ts', source: 'fetch(url);' }]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ file: 'src/web/other.ts', name: 'fetch' });
  });

  it('fails for an allow-list of two files', () => {
    const found = scanNetwork([fetchSrc], [DEMOS_FILE, 'src/web/other.ts']);
    expect(found.some((v) => v.name === 'allow-list')).toBe(true);
  });

  it('fails for another network API in demos.ts', () => {
    const found = scanNetwork([{ file: DEMOS_FILE, source: 'new XMLHttpRequest();' }]);
    expect(found.map((v) => v.name)).toEqual(['XMLHttpRequest']);
  });
});

describe('scan self-tests: forbidden phrases', () => {
  const names = (src: string): string[] => scanPhrasesInSource('f.ts', src).map((v) => v.name);

  it('reports a phrase in a string literal', () => {
    expect(names("const a = 'the first browser tool';")).toContain('first browser');
  });

  it('reports a phrase in a template text part', () => {
    expect(names('const a = `hello the first ${x}`;')).toContain('the first');
  });

  it('reports a phrase after a comment marker inside a string', () => {
    const found = scanPhrasesInSource('f.ts', 'const a = "// the only one";');
    expect(found.map((v) => v.name)).toContain('the only');
  });

  it('reports a phrase in a string inside a ${} expression', () => {
    expect(names("const a = `x ${ f('first ever') } y`;")).toContain('first ever');
  });

  it('ignores a phrase that appears only in comments', () => {
    expect(names('// the first browser\n/* the only one,\n first ever */\nconst a = 1;')).toEqual([]);
  });

  it('does not end a literal at an escaped quote', () => {
    const src = String.raw`const a = 'it\'s the first thing'; // the only`;
    expect(names(src)).toEqual(['the first']);
  });

  it('reports the line of a hit', () => {
    const found = scanPhrasesInSource('f.ts', "const a = 1;\nconst b = 'first-ever';");
    expect(found[0]?.line).toBe(2);
  });
});

describe('scan self-tests: html text and src/alt', () => {
  it('scans the visible text of HTML and not comments, scripts or attributes', () => {
    const html = '<p title="the first">hi <b>the first</b></p><!-- the only --><script>var a="the only"</script>';
    expect(scanPhrasesInHtml('index.html', html).map((v) => v.name)).toEqual(['the first']);
  });

  it('flags a stray img.alt = x', () => {
    const found = scanSrcAlt('src/web/dom/other.ts', 'img.alt = x;');
    expect(found.map((v) => v.name)).toEqual(['.alt']);
  });

  it('flags setAttribute with src and alt', () => {
    const found = scanSrcAlt('src/web/x.ts', "img.setAttribute('src', u); img.setAttribute('alt', n);");
    expect(found.map((v) => v.name).sort()).toEqual(["setAttribute('alt')", "setAttribute('src')"]);
  });

  it('exempts only the body of setSrcBlob in dom/h.ts', () => {
    const src = 'function setSrcBlob(i, u, n) { i.src = u; i.alt = n; }\nfunction other(i) { i.src = 1; }';
    const found = scanSrcAlt('src/web/dom/h.ts', src);
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(2);
    expect(scanSrcAlt('src/web/dom/other.ts', src)).toHaveLength(3);
  });
});

describe('scan self-tests: imports, globals, style, storage, expect', () => {
  it('allows only the two core index files', () => {
    const ok = "import { a } from '../core/fat12/index';\nimport { b } from '../core/formats';";
    expect(scanCoreImports('src/web/x.ts', ok)).toEqual([]);
    const bad = "import { c } from '../core/fat12/reader';";
    expect(scanCoreImports('src/web/x.ts', bad)).toHaveLength(1);
  });

  it('flags a main-thread import of a reader or converter function', () => {
    const src = "import { openDisk, other } from '../core/fat12';";
    expect(scanMainThreadImports('src/web/x.ts', src).map((v) => v.name)).toEqual(['openDisk']);
  });

  it('flags DOM globals but not property names', () => {
    expect(scanDomGlobals('l.ts', 'const a = document.title;').map((v) => v.name)).toEqual(['document']);
    expect(scanDomGlobals('l.ts', 'const a = obj.document; const b = { window: 1 };')).toEqual([]);
  });

  it('flags style API use', () => {
    expect(scanStyleUse('f.ts', 'el.style.color = c;').map((v) => v.name)).toEqual(['.style.']);
    expect(scanStyleUse('f.ts', "document.createElement('style');").map((v) => v.name)).toEqual([
      "createElement('style')",
    ]);
  });

  it('flags storage names', () => {
    expect(scanStorage('f.ts', 'localStorage.setItem(a, b);').map((v) => v.name)).toEqual(['localStorage']);
  });

  it('flags expect( inside an fc.property callback only', () => {
    const bad = 'fc.assert(fc.property(fc.nat(), (n) => { expect(n).toBe(n); }));';
    const good = 'it("x", () => { expect(1).toBe(1); }); fc.assert(fc.property(fc.nat(), (n) => n === n));';
    expect(scanExpectInProperty('t.ts', bad)).toHaveLength(1);
    expect(scanExpectInProperty('t.ts', good)).toEqual([]);
  });

  it('formats a violation with path, line and name', () => {
    const v: Violation = { file: 'src/web/x.ts', line: 7, name: 'eval' };
    expect(formatViolations([v])).toBe('src/web/x.ts:7 eval');
  });

  it('parses a small HTML document (sanity check for the text reader)', () => {
    expect(visibleText(parseHtml('<p>a <b>b</b></p>'))).toBe('a b');
  });
});

// ------------------------------------------------------------ real scans

const ROOT = process.cwd();

function listFiles(dir: string): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listFiles(rel));
    else out.push(rel);
  }
  return out.sort();
}

function isTest(file: string): boolean {
  return /\.test\.ts$/.test(file);
}

function read(file: string): SourceFile {
  return { file, source: readFileSync(join(ROOT, file), 'utf8') };
}

function readIfExists(file: string): SourceFile[] {
  return existsSync(join(ROOT, file)) ? [read(file)] : [];
}

const webFiles = listFiles('src/web');
const tsSources: SourceFile[] = [
  ...webFiles.filter((f) => f.endsWith('.ts') && !isTest(f)).map(read),
  ...readIfExists('src/main.ts'),
];
const otherSources: SourceFile[] = [...readIfExists('index.html'), ...readIfExists('src/style.css')];
const allSources: SourceFile[] = [...tsSources, ...otherSources];
const testFiles: SourceFile[] = webFiles.filter(isTest).map(read);

function expectNone(violations: readonly Violation[]): void {
  expect(formatViolations(violations)).toBe('');
}

function eachSource(scan: (f: SourceFile) => Violation[], files: readonly SourceFile[]): Violation[] {
  return files.flatMap(scan);
}

describe('real scans over the Web_Sources', () => {
  it('finds at least the known Web_Sources', () => {
    expect(allSources.length).toBeGreaterThan(0);
  });

  it('has no HTML sinks (Req 1.5)', () => {
    expectNone(eachSource((f) => scanSinks(f.file, f.source), allSources));
  });

  it('confines network API names to fetch in demos.ts (Req 13.2, 13.5)', () => {
    expectNone(scanNetwork(allSources));
  });

  it('has no storage or cookie names (Req 13.7)', () => {
    expectNone(eachSource((f) => scanStorage(f.file, f.source), allSources));
  });

  it('has no forbidden phrases in string literals (Req 13.4, 13.6)', () => {
    expectNone(eachSource((f) => scanPhrasesInSource(f.file, f.source), tsSources));
  });

  it('has no forbidden phrases in the visible text of index.html (Req 13.4, 13.6)', () => {
    expectNone(eachSource((f) => scanPhrasesInHtml(f.file, f.source), otherSources.filter((f) => f.file.endsWith('.html'))));
  });

  it('sets src and alt only through setSrcBlob (Req 1.3)', () => {
    expectNone(eachSource((f) => scanSrcAlt(f.file, f.source), tsSources));
  });

  it('imports only the two core index files, tests included (Req 3.2, 15.4)', () => {
    expectNone(eachSource((f) => scanCoreImports(f.file, f.source), [...tsSources, ...testFiles]));
  });

  it('keeps reader and converter imports out of main-thread files (Req 3.1)', () => {
    const mainThread = tsSources.filter(
      (f) => !f.file.startsWith('src/web/logic/') && !f.file.startsWith('src/web/worker/'),
    );
    expectNone(eachSource((f) => scanMainThreadImports(f.file, f.source), mainThread));
  });

  it('references no DOM global in logic/ files (Req 15.1)', () => {
    const logic = tsSources.filter((f) => f.file.startsWith('src/web/logic/'));
    expectNone(eachSource((f) => scanDomGlobals(f.file, f.source), logic));
  });

  it('uses no style API in the Web_Sources (Req 2.4)', () => {
    expectNone(eachSource((f) => scanStyleUse(f.file, f.source), allSources));
  });

  it('has no expect( inside fc.property callbacks (Req 15.2)', () => {
    expectNone(eachSource((f) => scanExpectInProperty(f.file, f.source), testFiles));
  });
});
