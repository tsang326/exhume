// Shared path for read_grave and exhume: image -> disk -> grave -> bytes -> conversion.
// The core `error` text is never used; failures map to catalogue codes only.

import { openDisk } from '../core/fat12/index';
import type { DiskReport, Grave, Warning } from '../core/fat12/index';
import { convertAuto, detectFormat } from '../core/formats/index';
import type { ConversionResult } from '../core/formats/index';
import type { Outcome } from './errors';
import type { FileLayer } from './fs-layer';
import type { GraveArgs } from './args';
import { loadImage } from './paths';
import { viewPath } from './sanitize';

export interface ToolContext {
  root: string;
  fs: FileLayer;
}

export type ConversionSuccessAny = Extract<ConversionResult, { ok: true }>;

export interface Prepared {
  grave: Grave;
  conversion: ConversionSuccessAny;
  readWarnings: Warning[];
}

const SLASH = '/';

/** The tool-facing format name for a converter output extension. */
export function formatOf(extension: ConversionSuccessAny['extension']): 'markdown' | 'csv' | 'text' | 'png' {
  switch (extension) {
    case '.csv':
      return 'csv';
    case '.txt':
      return 'text';
    case '.png':
      return 'png';
    case '.md':
      return 'markdown';
  }
}

function lastSegment(corePath: string): string {
  return corePath.slice(corePath.lastIndexOf(SLASH) + 1);
}

function pathMatches(g: Grave, arg: string): boolean {
  return arg === g.path || arg === viewPath(g.path);
}

export function findGrave(report: DiskReport, path: string, id: number | undefined): Grave | null {
  if (id === undefined) {
    for (const g of report.files) {
      if (pathMatches(g, path)) return g;
    }
    return null;
  }
  const g = report.files[id];
  if (g === undefined || g.id !== id || !pathMatches(g, path)) return null;
  return g;
}

export function prepareGrave(ctx: ToolContext, args: GraveArgs): Outcome<Prepared> {
  const image = loadImage(ctx.fs, ctx.root, args.image);
  if (!image.ok) return image;

  const handle = openDisk(image.value);
  const grave = findGrave(handle.report, args.path, args.id);
  if (grave === null) return { ok: false, code: 'GRAVE_NOT_FOUND' };
  if (grave.kind === 'directory' || grave.state === 'lost') {
    return { ok: false, code: 'GRAVE_NOT_READABLE' };
  }

  const read = handle.readBytes(grave);
  if (!read.ok) return { ok: false, code: 'GRAVE_NOT_READABLE' };

  const name = lastSegment(grave.path);
  const conversion = convertAuto(read.bytes, name);
  if (!conversion.ok) {
    const format = detectFormat(read.bytes, name).format;
    return { ok: false, code: format === 'unknown' ? 'NO_CONVERTER' : 'CONVERSION_FAILED' };
  }
  return { ok: true, value: { grave, conversion, readWarnings: read.warnings } };
}
