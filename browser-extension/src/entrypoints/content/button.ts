import type { AutofillReport } from '@/lib/messages';
import logoSvg from '@/assets/logo.svg?raw';
import type { Translate } from '@/lib/i18n';

/**
 * Floating "Autofill" pill, rendered in a closed shadow root so the host
 * page's CSS can't touch it (and ours can't leak into the page).
 */

const STYLE = `
:host { all: initial; }
.wrap { position: fixed; right: 20px; bottom: 20px; z-index: 2147483646; font: 500 13px/1.3 Inter, system-ui, -apple-system, "Segoe UI", sans-serif; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.pill { display: inline-flex; align-items: center; gap: 8px; border: 0; border-radius: 999px; padding: 10px 16px 10px 10px; background: #b22a2b; color: #fff; cursor: pointer; box-shadow: 0 6px 20px rgba(178,42,43,.35); font: inherit; transition: transform .15s ease, box-shadow .15s ease; }
.pill:hover { transform: translateY(-1px); box-shadow: 0 10px 24px rgba(178,42,43,.4); }
.pill:active { transform: scale(.97); }
.pill[disabled] { opacity: .75; cursor: progress; }
.logo { width: 22px; height: 22px; border-radius: 50%; background: #fff; display: grid; place-items: center; }
.logo svg { width: 15px; height: 15px; }
.close { position: absolute; top: -6px; right: -6px; width: 18px; height: 18px; border-radius: 50%; border: 0; background: #111827; color: #fff; font-size: 11px; line-height: 18px; cursor: pointer; opacity: 0; transition: opacity .15s; }
.btn-host { position: relative; }
.btn-host:hover .close { opacity: 1; }
.toast { max-width: 280px; background: #111827; color: #f9fafb; padding: 10px 12px; border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.2); }
.toast b { color: #6ee7b7; }
.toast .warn { color: #fcd34d; }
@media (prefers-reduced-motion: reduce) { .pill { transition: none; } }
`;

const LOGO = logoSvg.replace(/fill="[^"]*"/g, 'fill="#b22a2b"').replace('<svg', '<svg aria-hidden="true"');

export function mountInPageButton(onClick: () => Promise<AutofillReport | { error: string }>, t: Translate): HTMLElement {
  // A button left by a previous (orphaned) copy of the script is replaced, not kept.
  document.querySelectorAll('[data-hustlen-ui]').forEach((el) => el.remove());
  const host = document.createElement('div');
  host.setAttribute('data-hustlen-ui', '');
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>${STYLE}</style>
    <div class="wrap" role="region" aria-label="hustlen.ai">
      <div class="toast" hidden></div>
      <div class="btn-host">
        <button class="pill" type="button"><span class="logo">${LOGO}</span><span class="label">${escapeHtml(t('PAGE_AUTOFILL'))}</span></button>
        <button class="close" type="button" aria-label="${escapeHtml(t('PAGE_HIDE'))}">✕</button>
      </div>
    </div>`;
  document.documentElement.appendChild(host);

  const pill = shadow.querySelector<HTMLButtonElement>('.pill')!;
  const label = shadow.querySelector<HTMLSpanElement>('.label')!;
  const toast = shadow.querySelector<HTMLDivElement>('.toast')!;
  let hideTimer: number | undefined;

  const show = (html: string) => {
    toast.innerHTML = html;
    toast.hidden = false;
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => (toast.hidden = true), 6000);
  };

  pill.addEventListener('click', async () => {
    pill.disabled = true;
    label.textContent = t('PAGE_FILLING');
    try {
      const r = await onClick();
      if ('error' in r) {
        show(`<span class="warn">${escapeHtml(r.error)}</span>`);
      } else {
        const review = r.needsReview.length ? ` · <span class="warn">${escapeHtml(t('PAGE_TO_REVIEW', { count: r.needsReview.length }))}</span>` : '';
        const open = r.unanswered.length ? ` · ${escapeHtml(t('PAGE_LEFT', { count: r.unanswered.length }))}` : '';
        show(`<b>${escapeHtml(t('PAGE_FILLED', { count: r.filled + r.aiAnswered }))}</b>${review}${open}<br><small>${escapeHtml(t('PAGE_REVIEW_HINT'))}</small>`);
      }
    } finally {
      pill.disabled = false;
      label.textContent = t('PAGE_AUTOFILL');
    }
  });
  shadow.querySelector('.close')!.addEventListener('click', () => host.remove());
  return host;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export interface PromptOptions {
  title: string;
  body: string;
  primary: string;
  secondary: string;
  onPrimary: () => void | Promise<void>;
  onSecondary?: () => void | Promise<void>;
}

/**
 * A small confirmation card (e.g. "Save 3 new answers for next time?"),
 * in its own closed shadow root, bottom-right, above the Autofill pill.
 */
export function showPrompt(opts: PromptOptions): () => void {
  document.querySelectorAll('[data-hustlen-prompt]').forEach((el) => el.remove());
  const host = document.createElement('div');
  host.setAttribute('data-hustlen-ui', '');
  host.setAttribute('data-hustlen-prompt', '');
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>
    :host { all: initial; }
    .card { position: fixed; right: 20px; bottom: 76px; z-index: 2147483647; width: 300px; box-sizing: border-box;
      font: 400 13px/1.45 Inter, system-ui, -apple-system, "Segoe UI", sans-serif; color: #f9fafb; background: #111827;
      border-radius: 12px; padding: 14px; box-shadow: 0 12px 32px rgba(0,0,0,.28); }
    .head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-weight: 600; font-size: 13.5px; }
    .logo { width: 20px; height: 20px; border-radius: 6px; background: #b22a2b; display: grid; place-items: center; flex-shrink: 0; }
    .logo svg { width: 14px; height: 14px; } .logo svg path { fill: #fff; }
    p { margin: 0 0 12px; color: #d1d5db; }
    .row { display: flex; gap: 8px; justify-content: flex-end; }
    button { font: 600 12.5px/1 inherit; border-radius: 8px; padding: 8px 12px; cursor: pointer; border: 0; }
    .primary { background: #b22a2b; color: #fff; } .primary:hover { background: #8f1f20; }
    .secondary { background: transparent; color: #d1d5db; border: 1px solid #374151; }
    @media (prefers-reduced-motion: no-preference) { .card { animation: in .18s ease-out; } @keyframes in { from { opacity: 0; transform: translateY(6px); } } }
  </style>
  <div class="card" role="dialog" aria-live="polite">
    <div class="head"><span class="logo">${LOGO}</span><span class="title"></span></div>
    <p class="body"></p>
    <div class="row"><button class="secondary" type="button"></button><button class="primary" type="button"></button></div>
  </div>`;
  shadow.querySelector('.title')!.textContent = opts.title;
  shadow.querySelector('.body')!.textContent = opts.body;
  const primary = shadow.querySelector<HTMLButtonElement>('.primary')!;
  const secondary = shadow.querySelector<HTMLButtonElement>('.secondary')!;
  primary.textContent = opts.primary;
  secondary.textContent = opts.secondary;
  const close = () => host.remove();
  primary.addEventListener('click', async () => {
    primary.disabled = true;
    await opts.onPrimary();
    close();
  });
  secondary.addEventListener('click', async () => {
    await opts.onSecondary?.();
    close();
  });
  document.documentElement.appendChild(host);
  setTimeout(close, 30_000);
  return close;
}
