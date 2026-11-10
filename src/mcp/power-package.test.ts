import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const POWER_DIR = resolve(ROOT, 'power');
const PLUGIN_JSON = resolve(POWER_DIR, 'plugin.json');
const SKILL_DIR_NAME = 'floppy-images';
const SKILL_MD = resolve(POWER_DIR, 'skills', SKILL_DIR_NAME, 'SKILL.md');
const POWER_MD = resolve(POWER_DIR, 'POWER.md');
const STEERING_MD = resolve(POWER_DIR, 'steering', 'floppy-images.md');

const SCHEMA_URL = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const KEYWORDS = ['floppy', 'disk image', 'FAT12', 'WordStar', 'dBase', 'PCX', 'undelete'];
const KNOWN_FIELDS = ['$schema', 'name', 'version', 'description', 'author', 'keywords', 'license'];
const NAME_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const NAME_MAX = 64;
const DATA_RULE = /(never|not) (as )?an instruction/i;

function readText(file: string): string {
  return readFileSync(file, 'utf8');
}

function readObject(file: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readText(file));
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${file} is not a JSON object`);
  }
  return value as Record<string, unknown>;
}

function frontMatter(text: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const result: Record<string, string> = {};
  if (match === null || match[1] === undefined) return result;
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx > 0) result[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return result;
}

describe('power/plugin.json', () => {
  const plugin = readObject(PLUGIN_JSON);

  it('has the six fields plus license and no unknown top-level field', () => {
    for (const field of KNOWN_FIELDS) expect(plugin).toHaveProperty(field);
    expect(Object.keys(plugin).sort()).toEqual([...KNOWN_FIELDS].sort());
  });

  it('uses the exact schema URL', () => {
    expect(plugin['$schema']).toBe(SCHEMA_URL);
  });

  it('has a valid name', () => {
    const name = plugin['name'];
    expect(typeof name).toBe('string');
    const text = String(name);
    expect(text).toMatch(NAME_PATTERN);
    expect(text).not.toContain('--');
    expect(text).not.toContain('..');
    expect(text.length).toBeLessThanOrEqual(NAME_MAX);
  });

  it('has the version of package.json', () => {
    const pkg = readObject(resolve(ROOT, 'package.json'));
    expect(plugin['version']).toBe(pkg['version']);
  });

  it('has the MIT license, matching the LICENSE file', () => {
    expect(plugin['license']).toBe('MIT');
    expect(readText(resolve(ROOT, 'LICENSE'))).toMatch(/^MIT License/);
  });

  it('has the recorded keywords, all non-empty strings', () => {
    const keywords = plugin['keywords'];
    expect(Array.isArray(keywords)).toBe(true);
    for (const k of keywords as unknown[]) {
      expect(typeof k).toBe('string');
      expect((k as string).length).toBeGreaterThan(0);
    }
    expect(keywords).toEqual(KEYWORDS);
  });
});

describe('power/skills/floppy-images/SKILL.md', () => {
  const text = readText(SKILL_MD);
  const meta = frontMatter(text);

  it('has name and description front matter, name equal to its directory', () => {
    expect(meta['name']).toBe(SKILL_DIR_NAME);
    expect((meta['description'] ?? '').length).toBeGreaterThan(0);
  });

  it('does not refer to the MCP server by name', () => {
    expect(text).not.toMatch(/power-exhume/);
    expect(text).not.toMatch(/mcpServers/);
    expect(text).not.toMatch(/exhume server/i);
  });
});

describe('guidance documents', () => {
  const docs: Array<[string, string]> = [
    ['POWER.md', POWER_MD],
    ['steering/floppy-images.md', STEERING_MD],
    ['skill', SKILL_MD],
  ];

  for (const [label, file] of docs) {
    it(`${label} mentions workspace and the data-not-instructions rule`, () => {
      const text = readText(file);
      expect(text).toContain('workspace');
      expect(text).toMatch(DATA_RULE);
    });
  }

  it('POWER.md dropped the old section and keeps Default_Mode for the Workspace_Config', () => {
    const text = readText(POWER_MD);
    expect(text).not.toContain('Working directory and');
    expect(text).toMatch(/Workspace_Config|\.kiro\/settings\/mcp\.json/);
    expect(text).toContain('Default_Mode');
    expect(text).toMatch(/keeps using Default_Mode/);
  });
});
