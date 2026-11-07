// Report views: disk-derived text is sanitized and capped before it leaves the server.

import type {
  DiskReport,
  Grave,
  GraveKind,
  GraveState,
  GeometrySource,
  Warning,
} from '../core/fat12/index';
import type { ConversionWarning } from '../core/formats/index';
import { withEnvelope } from './envelope';
import {
  MAX_NAME_CHARS,
  MAX_REASON_CHARS_OUT,
  MAX_REPORT_ENTRIES,
  MAX_REPORT_WARNINGS,
} from './limits';
import { capUnits, sanitizeText, viewPath } from './sanitize';

export interface EntryView {
  id: number;
  path: string;
  kind: GraveKind;
  state: GraveState;
  size: number;
  date: string | null;
  reason?: string;
}

export interface WarningView {
  code: string;
  message: string;
  path?: string;
}

export interface GraveView {
  id: number;
  path: string;
  state: GraveState;
  kind: GraveKind;
  size: number;
  reason?: string;
}

export interface WarningViews {
  warnings: WarningView[];
  warningsOmitted: number;
}

export interface OpenDiskResult {
  untrusted: true;
  notice: string;
  volume: { label: string; geometrySource: GeometrySource };
  totalEntries: number;
  counts: { alive: number; recovered: number; partial: number; lost: number };
  entries: EntryView[];
  truncated: boolean;
  warnings: WarningView[];
  warningsOmitted: number;
}

function oneLine(s: string, cap: number): string {
  return capUnits(sanitizeText(s, { multiline: false }), cap);
}

function entryView(g: Grave): EntryView {
  const view: EntryView = {
    id: g.id,
    path: viewPath(g.path),
    kind: g.kind,
    state: g.state,
    size: g.size,
    date: g.date,
  };
  if (g.reason !== undefined) view.reason = oneLine(g.reason, MAX_REASON_CHARS_OUT);
  return view;
}

export function toGraveView(g: Grave): GraveView {
  const view: GraveView = {
    id: g.id,
    path: viewPath(g.path),
    state: g.state,
    kind: g.kind,
    size: g.size,
  };
  if (g.reason !== undefined) view.reason = oneLine(g.reason, MAX_REASON_CHARS_OUT);
  return view;
}

function warningView(code: string, message: string, path: string | undefined): WarningView {
  const view: WarningView = { code, message: oneLine(message, MAX_REASON_CHARS_OUT) };
  if (path !== undefined) view.path = viewPath(path);
  return view;
}

/** Core read warnings first, then conversion warnings; keeps the first MAX_REPORT_WARNINGS. */
export function toWarningViews(
  core: readonly Warning[],
  conv: readonly ConversionWarning[],
): WarningViews {
  const all: WarningView[] = [];
  const total = core.length + conv.length;
  for (const w of core) {
    if (all.length >= MAX_REPORT_WARNINGS) break;
    all.push(warningView(w.code, w.message, w.path));
  }
  for (const w of conv) {
    if (all.length >= MAX_REPORT_WARNINGS) break;
    all.push(warningView(w.code, w.message, undefined));
  }
  return { warnings: all, warningsOmitted: total - all.length };
}

export function toReportView(report: DiskReport): OpenDiskResult {
  const counts = { alive: 0, recovered: 0, partial: 0, lost: 0 };
  for (const g of report.files) counts[g.state] += 1;
  const entries = report.files.slice(0, MAX_REPORT_ENTRIES).map(entryView);
  const { warnings, warningsOmitted } = toWarningViews(report.warnings, []);
  return withEnvelope({
    volume: {
      label: oneLine(report.volume.label, MAX_NAME_CHARS),
      geometrySource: report.volume.geometrySource,
    },
    totalEntries: report.files.length,
    counts,
    entries,
    truncated: report.files.length > MAX_REPORT_ENTRIES,
    warnings,
    warningsOmitted,
  });
}
