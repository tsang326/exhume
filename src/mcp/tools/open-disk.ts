// open_disk: confine, read, open, report. Stateless; nothing is written.

import { openDisk } from '../../core/fat12/index';
import { parseOpenDisk } from '../args';
import type { Outcome } from '../errors';
import type { ToolContext } from '../grave-source';
import { loadImage } from '../paths';
import { toReportView } from '../report-view';

export function runOpenDisk(ctx: ToolContext, args: unknown): Outcome<unknown> {
  const parsed = parseOpenDisk(args);
  if (!parsed.ok) return parsed;
  const image = loadImage(ctx.fs, ctx.root, parsed.value.image);
  if (!image.ok) return image;
  const { report } = openDisk(image.value);
  return { ok: true, value: toReportView(report) };
}
