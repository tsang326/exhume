/**
 * Pure validation for demo disk registry entries (Requirement 8, criteria 3 to 6).
 * No I/O, never throws. Deliberately does not import `../demos`.
 */

export interface DemoEntryShape {
  id: string;
  title: string;
  description: string;
  url: string;
}

export type DemoCheck =
  | { ok: true }
  | { ok: false; field: 'id' | 'title' | 'description' | 'url'; message: string };

const URL_PREFIX = '/disks/';

function bad(field: 'id' | 'title' | 'description' | 'url', message: string): DemoCheck {
  return { ok: false, field, message };
}

function hasLineBreak(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 10 || c === 13) return true;
  }
  return false;
}

/** Returns a message when the URL is unsafe, otherwise null. Plain loops, string as written. */
function urlProblem(url: string): string | null {
  if (url.length < URL_PREFIX.length + 1) {
    return url.startsWith(URL_PREFIX)
      ? 'The URL needs a file name after /disks/.'
      : 'The URL must start with /disks/.';
  }
  if (url.charCodeAt(0) === 47 && url.charCodeAt(1) === 47) return 'The URL must not start with //.';
  if (!url.startsWith(URL_PREFIX)) return 'The URL must start with /disks/.';

  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    if (c === 92) return 'The URL must not contain a backslash.';
    if (c === 37 && i + 2 < url.length) {
      const a = url.charCodeAt(i + 1);
      const b = url.charCodeAt(i + 2);
      if (a === 50 && (b === 69 || b === 101 || b === 70 || b === 102)) {
        return 'The URL must not contain %2e or %2f.';
      }
    }
  }

  // Scheme: a name followed by ':' before the first '/' (cannot occur after the prefix check,
  // kept as an explicit guard) or any segment that begins with `name:`.
  let segStart = 0;
  for (let i = 0; i <= url.length; i++) {
    if (i === url.length || url.charCodeAt(i) === 47) {
      const len = i - segStart;
      if (len === 2 && url.charCodeAt(segStart) === 46 && url.charCodeAt(segStart + 1) === 46) {
        return 'The URL must not contain a .. segment.';
      }
      for (let j = segStart; j < i; j++) {
        const ch = url.charCodeAt(j);
        if (ch === 58) {
          if (j > segStart) return 'The URL must not contain a scheme.';
          break;
        }
        const isNameChar =
          (ch >= 65 && ch <= 90) ||
          (ch >= 97 && ch <= 122) ||
          (ch >= 48 && ch <= 57) ||
          ch === 43 ||
          ch === 45 ||
          ch === 46;
        if (!isNameChar) break;
      }
      segStart = i + 1;
    }
  }

  if (url.length === URL_PREFIX.length) return 'The URL needs a file name after /disks/.';
  return null;
}

export function validateDemoDisk(entry: unknown): DemoCheck {
  try {
    if (typeof entry !== 'object' || entry === null) return bad('id', 'The entry is not an object.');
    const e = entry as Record<string, unknown>;
    const id = e.id;
    const title = e.title;
    const description = e.description;
    const url = e.url;

    if (typeof id !== 'string' || id.length < 1 || id.length > 64) {
      return bad('id', 'The id must be 1 to 64 characters.');
    }
    if (typeof title !== 'string' || title.length < 1 || title.length > 80) {
      return bad('title', 'The title must be 1 to 80 characters.');
    }
    if (typeof description !== 'string' || description.length < 1 || description.length > 200) {
      return bad('description', 'The description must be 1 to 200 characters.');
    }
    if (hasLineBreak(description)) return bad('description', 'The description must be one line.');
    if (typeof url !== 'string') return bad('url', 'The URL must be a string.');
    const problem = urlProblem(url);
    if (problem !== null) return bad('url', problem);
    return { ok: true };
  } catch {
    return bad('id', 'The entry could not be read.');
  }
}

export function selectValidDemos<T extends DemoEntryShape>(entries: readonly T[]): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  try {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!validateDemoDisk(entry).ok) continue;
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      out.push(entry);
    }
  } catch {
    // Keep what was collected so far.
  }
  return out;
}
