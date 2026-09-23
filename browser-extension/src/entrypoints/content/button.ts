import type { AutofillReport } from '@/lib/messages';
import logoSvg from '@/assets/logo.svg?raw';

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

export function mountInPageButton(onClick: () => Promise<AutofillReport | { error: string }>): void {
  if (document.querySelector('[data-hustlen-ui]')) return;
  const host = document.createElement('div');
  host.setAttribute('data-hustlen-ui', '');
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>${STYLE}</style>
    <div class="wrap" role="region" aria-label="hustlen.ai">
      <div class="toast" hidden></div>
      <div class="btn-host">
        <button class="pill" type="button"><span class="logo">${LOGO}</span><span class="label">Autofill</span></button>
        <button class="close" type="button" aria-label="Hide">✕</button>
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
    label.textContent = 'Filling…';
    try {
      const r = await onClick();
      if ('error' in r) {
        show(`<span class="warn">${escapeHtml(r.error)}</span>`);
      } else {
        const review = r.needsReview.length ? ` · <span class="warn">${r.needsReview.length} to review</span>` : '';
        const open = r.unanswered.length ? ` · ${r.unanswered.length} left for you` : '';
        show(`<b>${r.filled + r.aiAnswered} fields filled</b>${review}${open}<br><small>Review everything before you submit.</small>`);
      }
    } finally {
      pill.disabled = false;
      label.textContent = 'Autofill';
    }
  });
  shadow.querySelector('.close')!.addEventListener('click', () => host.remove());
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
