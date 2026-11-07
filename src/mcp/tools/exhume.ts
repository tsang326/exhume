// exhume: write the converted file into the fixed exhumed folder. No destination argument exists.

import { parseGraveArgs } from '../args';
import { withEnvelope } from '../envelope';
import type { Outcome } from '../errors';
import { writeExhumed } from '../exhume-writer';
import { formatOf, prepareGrave } from '../grave-source';
import type { ToolContext } from '../grave-source';
import { MAX_REASON_CHARS_OUT } from '../limits';
import { capUnits, sanitizeText } from '../sanitize';

export function runExhume(ctx: ToolContext, args: unknown): Outcome<unknown> {
  const parsed = parseGraveArgs(args);
  if (!parsed.ok) return parsed;
  const prepared = prepareGrave(ctx, parsed.value);
  if (!prepared.ok) return prepared;

  const written = writeExhumed(ctx.fs, ctx.root, prepared.value);
  if (!written.ok) return written;

  const { grave, conversion } = prepared.value;
  const format = formatOf(conversion.extension);
  const body = {
    path: written.value.relPath,
    bytes: written.value.bytes,
    format,
    mime: conversion.mime,
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
