// Preview dialog. Built with h() and Text nodes only; the page behind is made inert while it is open.
import { parseMarkdown } from '../logic/markdown';
import type { DownloadSpec, PreviewModel } from '../logic/preview-model';
import type { BlobUrlManager } from './blob-urls';
import type { Downloader } from './download';
import { trapTab } from './focus-trap';
import { clear, h, setSrcBlob } from './h';
import { buildCsvTable, buildHexView, buildMarkdown } from './preview-content';

export interface PreviewPanel {
  open(model: PreviewModel, opener: HTMLElement | null): void;
  close(): void;
  isOpen(): boolean;
}

export interface PreviewDeps {
  blobs: BlobUrlManager;
  downloader: Downloader;
  fallbackFocus: () => HTMLElement;
  background: HTMLElement;
}

export const SHORTENED_NOTE = 'Only the start of the text is shown here. The download has all of it.';
export const IMAGE_FAILED_MESSAGE = 'The image could not be shown.';

interface Mounted {
  backdrop: HTMLElement;
  opener: HTMLElement | null;
  urls: string[];
  wasInert: boolean;
}

export function createPreviewPanel(deps: PreviewDeps): PreviewPanel {
  let mounted: Mounted | null = null;

  function buildBody(model: PreviewModel, urls: string[]): HTMLElement[] {
    const out: HTMLElement[] = [];
    const body = model.body;
    switch (body.kind) {
      case 'markdown': {
        const box = h('div', { class: 'preview-scroll preview-markdown', tabindex: '0', role: 'region', 'aria-label': 'Document text' });
        box.appendChild(buildMarkdown(parseMarkdown(body.text)));
        out.push(box);
        if (body.shortened) out.push(h('p', { class: 'preview-shortened' }, SHORTENED_NOTE));
        break;
      }
      case 'csv':
        out.push(buildCsvTable(body.table));
        break;
      case 'png': {
        const { alt: safeName } = body;
        let url: string | null = null;
        try {
          url = deps.blobs.create(new Blob([body.png as BlobPart], { type: 'image/png' }));
          urls.push(url);
          const img = h('img', { class: 'preview-png' }) as HTMLImageElement;
          setSrcBlob(img, url, safeName, deps.blobs.isOwned);
          out.push(h('div', { class: 'preview-scroll preview-image' }, img));
        } catch {
          if (url !== null) deps.blobs.revoke(url);
          out.push(h('p', { class: 'preview-error', role: 'alert' }, IMAGE_FAILED_MESSAGE));
        }
        break;
      }
      case 'hex':
        out.push(buildHexView(body.rows));
        if (body.shownBytes < body.totalBytes) {
          out.push(h('p', { class: 'preview-shortened' }, `Showing ${body.shownBytes} of ${body.totalBytes} bytes.`));
        }
        break;
      case 'none':
        break;
    }
    return out;
  }

  function buildDownload(spec: DownloadSpec, status: HTMLElement): HTMLElement {
    const button = h('button', { class: 'preview-download', type: 'button' }, spec.label);
    button.addEventListener('click', () => {
      const result = deps.downloader.start(spec);
      clear(status);
      if (!result.ok) status.appendChild(document.createTextNode(result.message));
    });
    return button;
  }

  function teardown(): Mounted | null {
    const m = mounted;
    if (m === null) return null;
    mounted = null;
    for (const url of m.urls) deps.blobs.revoke(url);
    if (m.backdrop.parentNode !== null) m.backdrop.parentNode.removeChild(m.backdrop);
    return m;
  }

  function open(model: PreviewModel, opener: HTMLElement | null): void {
    // A second preview replaces the first; the page stays inert and the first opener is kept.
    const previous = teardown();
    const urls: string[] = [];

    const heading = h('h2', { id: 'preview-title', tabindex: '-1' }, model.title);
    const closeButton = h('button', { class: 'preview-close', type: 'button' }, 'Close');
    closeButton.addEventListener('click', () => close());
    const dialog = h(
      'div',
      { class: 'preview', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'preview-title' },
      h('header', { class: 'preview-header' }, heading, closeButton),
    );
    if (model.partialNote !== null) dialog.appendChild(h('p', { class: 'preview-partial' }, model.partialNote));
    if (model.error !== null) dialog.appendChild(h('p', { class: 'preview-error', role: 'alert' }, model.error));
    if (model.warnings.length > 0) {
      dialog.appendChild(
        h('ul', { class: 'preview-warnings', 'aria-label': 'Warnings' }, ...model.warnings.map((w) => h('li', {}, w))),
      );
    }
    for (const el of buildBody(model, urls)) dialog.appendChild(el);

    const status = h('p', { class: 'preview-status', role: 'alert' });
    const footer = h('footer', { class: 'preview-footer' }, ...model.downloads.map((d) => buildDownload(d, status)));
    footer.appendChild(status);
    dialog.appendChild(footer);

    const backdrop = h('div', { class: 'preview-backdrop' }, dialog);
    backdrop.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'Tab') {
        trapTab(dialog, e);
      }
    });

    const wasInert = previous !== null ? previous.wasInert : deps.background.hasAttribute('inert');
    deps.background.setAttribute('inert', '');
    document.body.appendChild(backdrop);
    mounted = { backdrop, opener: previous !== null ? previous.opener : opener, urls, wasInert };
    heading.focus();
  }

  function close(): void {
    const m = teardown();
    if (m === null) return;
    if (!m.wasInert) deps.background.removeAttribute('inert');
    const target = m.opener !== null && m.opener.isConnected ? m.opener : deps.fallbackFocus();
    target.focus();
  }

  return {
    open,
    close,
    isOpen: () => mounted !== null,
  };
}
