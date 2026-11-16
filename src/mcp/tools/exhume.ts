// exhume: write the converted file into the fixed exhumed folder. No destination argument exists.
// A file that no converter matches is copied byte for byte, named `<NAME>.<EXT>.bin`.

import { parseGraveArgs } from '../args';
import { withEnvelope } from '../envelope';
import type { Outcome } from '../errors';
import { writeExhumed, writeOriginal } from '../exhume-writer';
import { convertGrave, formatOf, readGraveSource } from '../grave-source';
import type { ToolContext } from '../grave-source';
import { MAX_REASON_CHARS_OUT } from '../limits';
import { capUnits, sanitizeText } from '../sanitize';

const ORIGINAL_MIME = 'application/octet-stream';

export function runExhume(ctx: ToolContext, args: unknown): Outcome<unknown> {
  const parsed = parseGraveArgs(args);
  if (!parsed.ok) return parsed;
  const source = readGraveSource(ctx, parsed.value);
  if (!source.ok) return source;

  const prepared = convertGrave(source.value);
  let out: { relPath: string; bytes: number };
  let format: string;
  let mime: string;
  if (prepared.ok) {
    const written = writeExhumed(ctx.fs, ctx.root, prepared.value);
    if (!written.ok) return written;
    out = written.value;
    format = formatOf(prepared.value.conversion.extension);
    mime = prepared.value.conversion.mime;
  } else if (prepared.code === 'NO_CONVERTER') {
    const written = writeOriginal(ctx.fs, ctx.root, source.value.grave.path, source.value.bytes);
    if (!written.ok) return written;
    out = written.value;
    format = 'original';
    mime = ORIGINAL_MIME;
  } else {
    return prepared;
  }

  const { grave } = source.value;
  const body = {
    path: out.relPath,
    bytes: out.bytes,
    format,
    mime,
    id: grave.id,
    state: grave.state,
    ...(grave.reason === undefined
      ? {}
      : {
          reason: capUnits(sanitizeText(grave.reason, { multiline: false }), MAX_REASON_CHARS_OUT),
        }),
  };
  return { ok: true, value: withEnvelope(body) };
}
