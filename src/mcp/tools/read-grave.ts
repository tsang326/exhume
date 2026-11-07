// read_grave: converted preview of one Grave. Text is sanitized and capped; PNG returns size facts only.

import { parseGraveArgs } from '../args';
import { withEnvelope } from '../envelope';
import type { Outcome } from '../errors';
import { prepareGrave } from '../grave-source';
import type { ToolContext } from '../grave-source';
import { MAX_TEXT_CHARS } from '../limits';
import { readPngInfo } from '../png-info';
import { toGraveView, toWarningViews } from '../report-view';
import { sanitizeCapped } from '../sanitize';

export function runReadGrave(ctx: ToolContext, args: unknown): Outcome<unknown> {
  const parsed = parseGraveArgs(args);
  if (!parsed.ok) return parsed;
  const prepared = prepareGrave(ctx, parsed.value);
  if (!prepared.ok) return prepared;

  const { grave, conversion, readWarnings } = prepared.value;
  const { warnings, warningsOmitted } = toWarningViews(readWarnings, conversion.warnings);
  const graveView = toGraveView(grave);

  if (typeof conversion.output === 'string') {
    const capped = sanitizeCapped(conversion.output, { multiline: true }, MAX_TEXT_CHARS);
    return {
      ok: true,
      value: withEnvelope({
        grave: graveView,
        format: conversion.extension === '.csv' ? 'csv' : 'markdown',
        mime: conversion.mime,
        extension: conversion.extension,
        text: capped.text,
        totalChars: capped.total,
        truncated: capped.truncated,
        warnings,
        warningsOmitted,
      }),
    };
  }

  const info = readPngInfo(conversion.output);
  if (!info.ok) return info;
  return {
    ok: true,
    value: withEnvelope({
      grave: graveView,
      format: 'png',
      mime: conversion.mime,
      width: info.value.width,
      height: info.value.height,
      bytes: conversion.output.length,
      warnings,
      warningsOmitted,
    }),
  };
}
