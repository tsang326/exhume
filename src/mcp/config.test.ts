import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SERVER_VERSION } from './server';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const POWER_DIR = resolve(ROOT, 'power');

const POWER_MD = resolve(POWER_DIR, 'POWER.md');
const POWER_MCP = resolve(POWER_DIR, 'mcp.json');
const POWER_STEERING = resolve(POWER_DIR, 'steering', 'floppy-images.md');
const WORKSPACE_MCP = resolve(ROOT, '.kiro', 'settings', 'mcp.json');

interface ServerEntry {
  command?: unknown;
  args?: unknown;
  [key: string]: unknown;
}

function readText(file: string): string {
  return readFileSync(file, 'utf8');
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readText(file)) as Record<string, unknown>;
}

function exhumeEntry(file: string): ServerEntry {
  const servers = readJson(file).mcpServers as Record<string, ServerEntry>;
  return servers.exhume as ServerEntry;
}

function argsOf(entry: ServerEntry): string[] {
  return entry.args as string[];
}

/** Parse the flat `key: value` frontmatter of POWER.md (inline arrays allowed). */
function frontmatter(text: string): Record<string, string | string[]> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) throw new Error('POWER.md has no frontmatter');
  const out: Record<string, string | string[]> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const value = kv[2]!.trim();
    out[kv[1]!] = value.startsWith('[') && value.endsWith(']')
      ? value.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''))
      : value.replace(/^["']|["']$/g, '');
  }
  return out;
}

const MCP_FILES: Array<[string, string, string]> = [
  ['power/mcp.json', POWER_MCP, POWER_DIR],
  ['.kiro/settings/mcp.json', WORKSPACE_MCP, ROOT],
];

describe('Power files exist', () => {
  it.each([POWER_MD, POWER_MCP, POWER_STEERING, WORKSPACE_MCP])('%s', (file) => {
    expect(existsSync(file)).toBe(true);
  });
});

describe('POWER.md frontmatter', () => {
  const fm = frontmatter(readText(POWER_MD));

  it('has the name and author', () => {
    expect(fm.name).toBe('exhume');
    expect(fm.author).toBe('tsang326');
  });

  it('has the required keywords', () => {
    const keywords = (fm.keywords as string[]).map((k) => k.toLowerCase());
    for (const k of ['floppy', 'disk image', 'fat12', 'wordstar', 'dbase', 'pcx']) {
      expect(keywords).toContain(k);
    }
  });
});

describe.each(MCP_FILES)('%s', (_label, file, base) => {
  const raw = readText(file);
  const entry = exhumeEntry(file);

  it('has a single exhume server run by node', () => {
    const servers = readJson(file).mcpServers as Record<string, unknown>;
    expect(Object.keys(servers)).toEqual(['exhume']);
    expect(entry.command).toBe('node');
  });

  it('has no autoApprove, npx, latest tag or URL', () => {
    expect(raw).not.toMatch(/autoApprove/i);
    expect(raw).not.toMatch(/npx/i);
    expect(raw).not.toMatch(/latest/i);
    expect(raw).not.toMatch(/https?:\/\//i);
    expect(entry).not.toHaveProperty('url');
    expect(entry).not.toHaveProperty('autoApprove');
  });

  it('names a script path that exists', () => {
    const script = argsOf(entry).find((a) => a.endsWith('.mjs'));
    expect(script).toBeDefined();
    expect(existsSync(resolve(base, script!))).toBe(true);
  });
});

describe('the two exhume entries agree', () => {
  const power = exhumeEntry(POWER_MCP);
  const workspace = exhumeEntry(WORKSPACE_MCP);
  const scriptOf = (e: ServerEntry): string => argsOf(e).find((a) => a.endsWith('.mjs'))!;

  it('use the same command', () => {
    expect(power.command).toBe(workspace.command);
  });

  // The only allowed difference is the path prefix: the Power entry is
  // relative to the Power folder ("server/..."), the workspace entry is
  // relative to the repository root ("power/server/...").
  it('name the same server file', () => {
    expect(basename(scriptOf(power))).toBe(basename(scriptOf(workspace)));
  });

  it('agree on whether --root is passed', () => {
    expect(argsOf(power).includes('--root')).toBe(argsOf(workspace).includes('--root'));
  });
});

describe('Power text', () => {
  const texts = [POWER_MD, POWER_STEERING].map(readText);

  it('makes no "first" claim', () => {
    for (const t of texts) {
      expect(t).not.toMatch(/\b(the|world'?s|very)\s+first\b/i);
      expect(t).not.toMatch(/\bfirst[- ](ever|of its kind|to|tool|and only)\b/i);
    }
  });

  it('credits andete/disk-peek', () => {
    expect(readText(POWER_MD)).toContain('andete/disk-peek');
  });
});

describe('versions agree', () => {
  const pkg = readJson(resolve(ROOT, 'package.json'));
  const lock = readJson(resolve(ROOT, 'package-lock.json'));
  const lockRoot = (lock.packages as Record<string, { version?: string }>)[''];
  const powerVersion = frontmatter(readText(POWER_MD)).version;

  it('package.json, lockfile, SERVER_VERSION and POWER.md are equal', () => {
    expect(typeof pkg.version).toBe('string');
    expect(lock.version).toBe(pkg.version);
    expect(lockRoot?.version).toBe(pkg.version);
    expect(SERVER_VERSION).toBe(pkg.version);
    expect(powerVersion).toBe(pkg.version);
  });
});
