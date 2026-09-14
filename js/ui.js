// Elementi di interfaccia: pannelli dal basso (sheet), conferme, notifiche (toast).
import { icon } from './icons.js';
import { esc } from './utils.js';

/** Chiede all'app di ridisegnare la schermata corrente (per stati locali delle viste) */
export const rerender = () => window.dispatchEvent(new CustomEvent('app:render'));

/** Schermo da computer: le schermate si dispongono su più colonne */
export const wideMQ = window.matchMedia('(min-width: 1100px)');
export const isWide = () => wideMQ.matches;

export function toast(message, { actionText, onAction, duration = 4500 } = {}) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(message)}</span>${actionText ? `<button class="toast-action">${esc(actionText)}</button>` : ''}`;
  host.appendChild(el);
  while (host.children.length > 2) host.firstElementChild.remove();
  requestAnimationFrame(() => el.classList.add('show'));
  const close = () => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  };
  const timer = setTimeout(close, duration);
  el.querySelector('.toast-action')?.addEventListener('click', () => {
    clearTimeout(timer);
    onAction?.();
    close();
  });
}

export function openSheet({ title = '', subtitle = '', body = '', footer = '', wide = false, onClose } = {}) {
  const host = document.getElementById('sheets');
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="sheet-backdrop" data-close></div>
    <section class="sheet ${wide ? 'sheet-wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-grab" aria-hidden="true"></div>
      <header class="sheet-head">
        <div class="sheet-head-text">
          <h2 class="sheet-title">${esc(title)}</h2>
          ${subtitle ? `<p class="sheet-sub">${subtitle}</p>` : ''}
        </div>
        <button class="icon-btn" data-close aria-label="Chiudi">${icon('x')}</button>
      </header>
      <div class="sheet-body">${body}</div>
      <footer class="sheet-foot" ${footer ? '' : 'hidden'}>${footer}</footer>
    </section>`;
  host.appendChild(wrap);
  document.body.classList.add('no-scroll');
  requestAnimationFrame(() => wrap.classList.add('open'));

  let closed = false;
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    wrap.classList.remove('open');
    setTimeout(() => {
      wrap.remove();
      if (!host.querySelector('.sheet-wrap')) document.body.classList.remove('no-scroll');
    }, 220);
    onClose?.();
  }
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });

  const el = wrap.querySelector('.sheet');

  // Sul telefono: trascina il pannello verso il basso per chiuderlo
  let startY = null;
  let dy = 0;
  const onStart = (e) => {
    if (window.innerWidth >= 700 || e.target.closest('button')) return;
    startY = e.touches[0].clientY;
    dy = 0;
    el.style.transition = 'none';
  };
  const onMove = (e) => {
    if (startY === null) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
    el.style.transform = `translateY(${dy}px)`;
  };
  const onEnd = () => {
    if (startY === null) return;
    startY = null;
    el.style.transition = '';
    el.style.transform = '';
    if (dy > 90) close();
  };
  for (const zone of el.querySelectorAll('.sheet-grab, .sheet-head')) {
    zone.addEventListener('touchstart', onStart, { passive: true });
    zone.addEventListener('touchmove', onMove, { passive: true });
    zone.addEventListener('touchend', onEnd);
    zone.addEventListener('touchcancel', onEnd);
  }

  return {
    el,
    close,
    setBody(html) { el.querySelector('.sheet-body').innerHTML = html; },
    setFooter(html) {
      const f = el.querySelector('.sheet-foot');
      f.innerHTML = html;
      f.hidden = !html;
    },
  };
}

export function confirmDialog({ title, message, confirmText = 'Conferma', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const s = openSheet({
      title,
      body: `<p class="lead">${message}</p>`,
      footer: `<button class="btn btn-ghost" data-close>Annulla</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(confirmText)}</button>`,
      onClose: () => { if (!answered) resolve(false); },
    });
    s.el.querySelector('[data-ok]').addEventListener('click', () => {
      answered = true;
      resolve(true);
      s.close();
    });
  });
}
