// Inline preview panel. Built with h() and Text nodes only.
// show() and clear() never move focus and never scroll; app.ts decides when to call focusHeading() or reveal().
import { parseMarkdown } from '../logic/markdown';
import type { DownloadSpec, PreviewModel } from '../logic/preview-model';
import type { BlobUrlManager } from './blob-urls';
import type { Downloader } from './download';
import { clear, h, setSrcBlob } from './h';
import { buildCsvTable, buildHexView, buildMarkdown } from './preview-content';

export interface PreviewPanel {
  show(model: PreviewModel): void;
  clear(): void;
  isShowing(): boolean;
  focusHeading(): void;
  reveal(reducedMotion: boolean): void;
  headingElement(): HTMLElement;
}

export interface PreviewDeps {
  blobs: BlobUrlManager;
  downloader: Downloader;
}

const SHORTENED_NOTE = 'Only the start of the text is shown here. The download has all of it.';
const IMAGE_FAILED_MESSAGE = 'The image could not be shown.';
const EMPTY_TITLE = 'Preview';
const EMPTY_TEXT = 'Choose a file to read it here.';
const CUT_LINE = 'The rest of this file was overwritten. Exhume stops here instead of guessing.';

export function createPreviewPanel(root: HTMLElement, deps: PreviewDeps): PreviewPanel {
  let urls: string[] = [];
  let showing = false;
  let heading: HTMLElement = h('h3', { id: 'preview-title', tabindex: '-1' }, EMPTY_TITLE);

  function buildBody(model: PreviewModel, owned: string[]): HTMLElement[] {
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
      case 'text': {
        // One Text node, so disk text can never become markup.
        out.push(
          h('div', { class: 'preview-scroll preview-text', tabindex: '0', role: 'region', 'aria-label': 'Document text' }, body.text),
        );
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
          owned.push(url);
          const img = h('img', { class: 'preview-png' }) as HTMLImageElement;
          setSrcBlob(img, url, safeName, deps.blobs.isOwned);
          out.push(h('div', { class: 'preview-scroll preview-image' }, img));
        } catch {
          if (url !== null) {
            deps.blobs.revoke(url);
            const i = owned.indexOf(url);
            if (i >= 0) owned.splice(i, 1);
          }
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

  function releaseUrls(): void {
    for (const url of urls) deps.blobs.revoke(url);
    urls = [];
  }

  function renderEmpty(): void {
    releaseUrls();
    clear(root);
    heading = h('h3', { id: 'preview-title', tabindex: '-1' }, EMPTY_TITLE);
    root.appendChild(heading);
    root.appendChild(h('p', { class: 'preview-empty' }, EMPTY_TEXT));
    showing = false;
  }

  function show(model: PreviewModel): void {
    releaseUrls();
    clear(root);
    const owned: string[] = [];

    heading = h('h3', { id: 'preview-title', tabindex: '-1' }, model.title);
    const status = h('p', { class: 'preview-status', role: 'alert' });
    const actions = h('div', { class: 'preview-actions' }, ...model.downloads.map((d) => buildDownload(d, status)));
    root.appendChild(
      h('div', { class: 'preview-top' }, h('div', {}, heading, h('p', { class: 'preview-kind' }, model.kindLabel)), actions),
    );

    if (model.partialNote !== null) root.appendChild(h('p', { class: 'preview-partial' }, model.partialNote));
    if (model.error !== null) root.appendChild(h('p', { class: 'preview-error', role: 'alert' }, model.error));
    if (model.warnings.length > 0) {
      root.appendChild(
        h('ul', { class: 'preview-warnings', 'aria-label': 'Warnings' }, ...model.warnings.map((w) => h('li', {}, w))),
      );
    }

    const bodyEls = buildBody(model, owned);
    if (bodyEls.length > 0) {
      const paper = h('div', { class: 'paper' });
      for (const el of bodyEls) paper.appendChild(el);
      root.appendChild(paper);
    }
    if (model.partialNote !== null) root.appendChild(h('p', { class: 'cut' }, CUT_LINE));
    root.appendChild(status);

    urls = owned;
    showing = true;
  }

  function focusHeading(): void {
    heading.focus({ preventScroll: true });
  }

  function reveal(reducedMotion: boolean): void {
    focusHeading();
    if (typeof heading.scrollIntoView === 'function') {
      heading.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' });
    }
  }

  renderEmpty();

  return {
    show,
    clear: renderEmpty,
    isShowing: () => showing,
    focusHeading,
    reveal,
    headingElement: () => heading,
  };
}
