// "Preventivi" (Nicolas e Martina): compila cliente e servizi, scegli il nome del file, guarda l'anteprima,
// scarica il PDF o invialo (WhatsApp, email…) con il foglio di condivisione del telefono.
import * as store from '../store.js';
import { icon } from '../icons.js';
import { toast, confirmDialog, isWide, rerender, openSheet } from '../ui.js';
import { sectionHead, emptyState } from '../components.js';
import { esc, uid, isIOS, fmtShort, toISO } from '../utils.js';
import {
  MAX_ROWS, PAGE, NOTE, COMPANY, formatAmount, buildQuotePdf, quoteFileName, defaultQuoteName, cleanFileName,
  drawQuoteOnCanvas, loadQuoteAssets, loadJsPdf,
} from '../quote-pdf.js';

const DRAFT_KEY = 'ftg-preventivo-bozza';
const HISTORY_KEY = 'ftg-preventivi-recenti';
const PERIODS = [
  { id: "l'anno", label: "all'anno" },
  { id: 'al mese', label: 'al mese' },
  { id: '', label: 'nessuna dicitura' },
];

// Servizi pronti da aggiungere con un tocco (quelli con il numero hanno il contatore)
const PRESETS = [
  { kind: 'sfalci', label: 'Sfalci', qty: 12, icon: 'grass', make: (n) => `${n} ${n === 1 ? 'sfalcio' : 'sfalci'} l'anno` },
  { kind: 'potature', label: 'Potature cespugli', qty: 2, icon: 'scissors', make: (n) => `${n} ${n === 1 ? 'potatura' : 'potature'} l'anno dei cespugli` },
  { kind: 'text', label: 'Raccolta foglie', icon: 'leaf', text: 'Raccolta foglie nel periodo autunnale' },
  { kind: 'text', label: 'Diserbante', icon: 'spray', text: 'Utilizzo del diserbante' },
  { kind: 'text', label: 'Materiale di risulta', icon: 'truck', text: 'Raccolta e smaltimento materiale di risulta' },
];
const presetOf = (kind) => PRESETS.find((p) => p.kind === kind && p.make);

const safeGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* spazio pieno o bloccato */ } };

// fileName vuoto = nome automatico "Preventivo FT Giardini - Cliente"
const emptyDraft = () => ({ id: uid('p_'), client: '', services: [], amount: '', period: "l'anno", fileName: '' });
let draft = { ...emptyDraft(), ...(safeGet(DRAFT_KEY) || {}) };
let assets = null;
let JsPDF = null;
let busy = false;

const saveDraft = () => safeSet(DRAFT_KEY, draft);
const rowText = (s) => (presetOf(s.kind) ? presetOf(s.kind).make(s.qty) : s.text || '');

/** Dati nel formato del PDF */
function quoteData(d = draft) {
  const amount = String(d.amount || '').trim();
  return {
    client: d.client.trim(),
    fileName: d.fileName,
    services: d.services.map((s) => ({ text: rowText(s).trim(), price: s.price || '' })).filter((s) => s.text || s.price),
    total: amount ? `${formatAmount(amount)}${d.period && !amount.includes(d.period) ? ' ' + d.period : ''}` : '',
  };
}

function history() { return safeGet(HISTORY_KEY) || []; }
function remember() {
  const q = quoteData();
  const list = history().filter((h) => h.id !== draft.id);
  list.unshift({ ...structuredClone(draft), savedAt: Date.now(), totalText: q.total, file: quoteFileName(q) });
  safeSet(HISTORY_KEY, list.slice(0, 20));
}

export function render() {
  if (!store.can('gestione')) {
    return { title: 'Preventivi', html: `<div class="card">${emptyState('lock', 'Accesso riservato', 'I preventivi sono disponibili per Nicolas e Martina.')}</div>` };
  }
  const wide = isWide();
  const d = draft;
  const count = d.services.length;
  const recent = history();
  const autoName = cleanFileName(defaultQuoteName(quoteData()));

  const head = `
    <div class="page-head page-head-row">
      <div class="grow">
        <h1>Preventivi</h1>
        <p>Compila e crea il PDF nello stile FT Giardini</p>
      </div>
      ${wide ? '' : `<button class="btn btn-ghost btn-sm" data-new>${icon('plus')}Nuovo</button>`}
    </div>`;

  const clientCard = `
    <div class="card">
      <div class="field">
        <label for="q-client">Cliente · nome e cognome *</label>
        <input id="q-client" class="input" data-q="client" value="${esc(d.client)}" placeholder="Es. Sandra Franzoni" autocomplete="off" autocapitalize="words" enterkeyhint="next">
      </div>
    </div>`;

  const servicesCard = `
    <div class="card">
      <div class="row-between"><span class="label">Servizi</span><span class="small muted">${count} di ${MAX_ROWS} righe</span></div>
      <p class="small muted" style="margin:2px 0 10px">Tocca per aggiungere. Il prezzo di ogni riga è facoltativo.</p>
      <div class="pick q-presets">
        ${PRESETS.map((p, i) => {
          const used = d.services.some((s) => (p.make ? s.kind === p.kind : s.text === p.text));
          return `<button data-preset="${i}" class="${used ? 'on' : ''}" ${count >= MAX_ROWS && !used ? 'disabled' : ''}>${icon(used ? 'check' : p.icon)}${esc(p.label)}</button>`;
        }).join('')}
        <button data-add-free ${count >= MAX_ROWS ? 'disabled' : ''}>${icon('plus')}Riga libera</button>
      </div>
      <div class="q-rows">
        ${d.services.map((s, i) => {
          const p = presetOf(s.kind);
          return `
          <div class="q-row" data-row="${i}">
            <div class="q-row-main">
              <span class="q-num">${i + 1}</span>
              ${p ? `
                <div class="q-qty">
                  <div class="stepper">
                    <button data-qty="${i}" data-delta="-1" aria-label="Meno">${icon('minus')}</button>
                    <input type="number" inputmode="numeric" min="1" max="99" value="${s.qty}" data-qty-input="${i}" aria-label="Quantità">
                    <button data-qty="${i}" data-delta="1" aria-label="Più">${icon('plus')}</button>
                  </div>
                  <span class="q-qty-text" data-qty-text="${i}">${esc(rowText(s))}</span>
                </div>`
              : `<input class="input" data-text="${i}" value="${esc(s.text)}" placeholder="Descrivi il servizio" autocomplete="off">`}
              <button class="icon-btn q-del" data-del="${i}" aria-label="Togli riga">${icon('trash')}</button>
            </div>
            <div class="q-row-extra">
              <input class="input q-price" data-price="${i}" value="${esc(s.price || '')}" placeholder="Prezzo (facoltativo)" inputmode="decimal" autocomplete="off">
              <span class="q-move">
                <button class="icon-btn" data-move="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Sposta su">${icon('up')}</button>
                <button class="icon-btn" data-move="${i}" data-dir="1" ${i === count - 1 ? 'disabled' : ''} aria-label="Sposta giù">${icon('down')}</button>
              </span>
            </div>
            <p class="q-warn small" data-warn="${i}" hidden>${icon('alert')}Testo lungo: nel PDF verrà scritto più piccolo o accorciato.</p>
          </div>`;
        }).join('')}
        ${!count ? `<div class="week-empty">Nessun servizio: aggiungine uno dai pulsanti qui sopra.</div>` : ''}
      </div>
    </div>`;

  const totalCard = `
    <div class="card">
      <span class="label">Totale</span>
      <div class="q-total">
        <div class="q-amount">
          <input class="input" data-q="amount" value="${esc(d.amount)}" placeholder="Es. 2000" inputmode="decimal" autocomplete="off" aria-label="Importo totale">
          <span>€</span>
        </div>
        <div class="seg q-period">${PERIODS.map((p) => `<button class="${d.period === p.id ? 'on' : ''}" data-period="${p.id}">${p.label}</button>`).join('')}</div>
      </div>
      <p class="small muted" style="margin-top:8px">Nel PDF: <b class="strong" data-total-text>${esc(quoteData().total || '—')}</b></p>
    </div>`;

  const fileCard = `
    <div class="card">
      <div class="field">
        <label for="q-file">Nome del file</label>
        <div class="q-file">
          <input id="q-file" class="input" data-q="fileName" value="${esc(d.fileName || autoName)}" autocomplete="off" spellcheck="false" enterkeyhint="done">
          <span class="q-file-ext">.pdf</span>
        </div>
        <div class="row-between">
          <p class="hint" data-file-hint>${d.fileName ? 'Nome scelto da te' : 'Nome automatico: si aggiorna con il cliente'}</p>
          <button class="link-btn" data-file-reset ${d.fileName ? '' : 'hidden'}>${icon('redo')}Automatico</button>
        </div>
      </div>
    </div>
    <div class="card q-fixed">
      ${icon('lock')}
      <div class="small">
        <b class="strong">Sempre uguali nel PDF:</b> logo, “${esc(NOTE)}”, contatti ${esc(COMPANY.email)} · ${esc(COMPANY.phone)}
      </div>
    </div>`;

  const canvas = '<div class="q-preview"><canvas data-preview width="612" height="792" aria-label="Anteprima del preventivo"></canvas></div>';

  const recentSec = recent.length ? `
    <div class="section">
      ${sectionHead('Preventivi recenti', '<span class="small muted">su questo dispositivo</span>')}
      <div class="card card-flush divided">
        ${recent.map((h) => `
          <div class="menu-row q-recent ${h.id === d.id ? 'is-current' : ''}">
            <button class="grow q-recent-open" data-open="${h.id}">
              <strong>${esc(h.client || 'Senza nome')}</strong>
              <small>${fmtShort(toISO(new Date(h.savedAt)))} · ${h.services.length} servizi${h.totalText ? ` · ${esc(h.totalText)}` : ''}</small>
              ${h.file ? `<small class="ellipsis">${icon('file')} ${esc(h.file)}</small>` : ''}
            </button>
            <button class="icon-btn" data-forget="${h.id}" aria-label="Togli dai recenti">${icon('x')}</button>
          </div>`).join('')}
      </div>
    </div>` : '';

  let html;
  if (wide) {
    html = `${head}
      <div class="cols cols-quote">
        <div class="cols-main">${clientCard}${servicesCard}${totalCard}${fileCard}${recentSec}</div>
        <aside class="cols-side cols-sticky">
          <div class="q-actions">
            <button class="btn btn-primary btn-block" data-download ${busy ? 'disabled' : ''}>${icon('download')}Scarica PDF</button>
            <button class="btn btn-whatsapp btn-block" data-share ${busy ? 'disabled' : ''}>${icon('share')}Invia su WhatsApp</button>
            <button class="btn btn-ghost btn-block" data-new>${icon('plus')}Nuovo preventivo</button>
          </div>
          <div class="section" style="margin-top:0">${sectionHead('Anteprima')}${canvas}</div>
        </aside>
      </div>`;
  } else {
    // Telefono: barra dei comandi sempre a portata di pollice
    html = `${head}${clientCard}${servicesCard}${totalCard}${fileCard}
      <div class="q-bar">
        <button class="btn btn-ghost" data-preview-open aria-label="Anteprima">${icon('eye')}<span>Anteprima</span></button>
        <button class="btn btn-primary" data-download ${busy ? 'disabled' : ''}>${icon('download')}<span>Scarica</span></button>
        <button class="btn btn-whatsapp" data-share ${busy ? 'disabled' : ''}>${icon('share')}<span>WhatsApp</span></button>
      </div>
      <div class="section">${sectionHead('Anteprima')}${canvas}</div>
      ${recentSec}`;
  }

  return { title: 'Preventivi', html, mount };
}

// ---------- Anteprima ----------

const frames = new WeakMap();
function paint(canvas) {
  if (!canvas || !assets) return;
  cancelAnimationFrame(frames.get(canvas));
  frames.set(canvas, requestAnimationFrame(() => {
    const cssW = canvas.clientWidth || 300;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssW * dpr * PAGE.h / PAGE.w);
    drawQuoteOnCanvas(canvas, quoteData(), assets.img);
  }));
}

function refreshDerived(root) {
  const total = root.querySelector('[data-total-text]');
  if (total) total.textContent = quoteData().total || '—';
  // nome automatico del file che segue il cliente
  const file = root.querySelector('[data-q="fileName"]');
  if (file && !draft.fileName && document.activeElement !== file) file.value = cleanFileName(defaultQuoteName(quoteData()));
  const hint = root.querySelector('[data-file-hint]');
  if (hint) hint.textContent = draft.fileName ? 'Nome scelto da te' : 'Nome automatico: si aggiorna con il cliente';
  const reset = root.querySelector('[data-file-reset]');
  if (reset) reset.hidden = !draft.fileName;
  root.querySelectorAll('[data-preview]').forEach(paint);
  // avviso per le righe troppo lunghe
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = '8px Helvetica, Arial, sans-serif';
  draft.services.forEach((s, i) => {
    const warn = root.querySelector(`[data-warn="${i}"]`);
    if (warn) warn.hidden = ctx.measureText(rowText(s)).width <= 358;
  });
}

// ---------- PDF ----------

async function ensureReady() {
  [assets, JsPDF] = await Promise.all([assets || loadQuoteAssets(), JsPDF || loadJsPdf()]);
}

function validate() {
  if (!draft.client.trim()) return 'Scrivi nome e cognome del cliente';
  if (!quoteData().services.length) return 'Aggiungi almeno un servizio';
  return '';
}

function makeFile() {
  const q = quoteData();
  const blob = buildQuotePdf(JsPDF, q, assets.data).output('blob');
  return new File([blob], quoteFileName(q), { type: 'application/pdf' });
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const canShareFile = (file) => { try { return !!navigator.canShare?.({ files: [file] }); } catch { return false; } };

async function sharePdf(file) {
  try {
    await navigator.share({ files: [file], title: file.name.replace(/\.pdf$/, '') });
  } catch (err) {
    if (err?.name !== 'AbortError') throw err; // chiuso dall'utente: nessun errore
  }
}

async function exportPdf(mode) {
  const err = validate();
  if (err) { toast(err); return false; }
  if (!assets || !JsPDF) {
    try { await ensureReady(); } catch (e) { toast(e.message); return false; }
  }
  let file;
  try {
    file = makeFile();
  } catch (e) {
    console.error(e);
    toast('Non sono riuscito a creare il PDF, riprova.');
    return false;
  }
  remember();
  saveDraft();

  try {
    if (mode === 'share') {
      if (canShareFile(file)) {
        await sharePdf(file);
      } else {
        downloadFile(file);
        toast('PDF scaricato: in WhatsApp tocca la graffetta → Documento e allegalo.', { duration: 7000 });
      }
    } else if (isIOS() && canShareFile(file)) {
      // su iPhone il foglio di condivisione permette "Salva su File" senza uscire dall'app
      await sharePdf(file);
    } else {
      downloadFile(file);
      toast(`Scaricato: ${file.name}`);
    }
  } catch (e) {
    console.warn('Condivisione non riuscita', e);
    if (e?.name === 'NotAllowedError') toast('Tocca di nuovo il pulsante per inviare il PDF.');
    else { downloadFile(file); toast('Condivisione non disponibile: il PDF è stato scaricato.'); }
  }
  return true;
}

// Scarica/Invia (dalla pagina o dall'anteprima a schermo intero)
async function runExport(mode, buttons) {
  if (busy) return;
  busy = true;
  buttons.forEach((b) => { b.disabled = true; });
  const before = JSON.stringify(history()[0] || null);
  try {
    await exportPdf(mode);
  } finally {
    busy = false;
    buttons.forEach((b) => { b.disabled = false; });
  }
  return before !== JSON.stringify(history()[0] || null);
}

function openPreviewSheet() {
  const s = openSheet({
    title: 'Anteprima',
    subtitle: esc(quoteFileName(quoteData())),
    body: '<div class="q-preview q-preview-sheet"><canvas data-preview width="612" height="792" aria-label="Anteprima del preventivo"></canvas></div>',
    footer: `<button class="btn btn-primary" data-sheet-download>${icon('download')}Scarica</button><button class="btn btn-whatsapp" data-sheet-share>${icon('share')}WhatsApp</button>`,
    wide: true,
  });
  const draw = () => paint(s.el.querySelector('[data-preview]'));
  if (assets) setTimeout(draw, 60);
  else ensureReady().then(draw).catch((e) => toast(e.message));
  s.el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-sheet-download], [data-sheet-share]');
    if (!b) return;
    const changed = await runExport('sheetShare' in b.dataset ? 'share' : 'download', [...s.el.querySelectorAll('.sheet-foot .btn')]);
    if (changed) setTimeout(rerender, 300);
  });
}

// ---------- Eventi ----------

function mount(root) {
  const changed = () => { saveDraft(); refreshDerived(root); };

  refreshDerived(root);
  ensureReady().then(() => refreshDerived(root)).catch((e) => console.warn(e));
  const onResize = () => root.querySelectorAll('[data-preview]').forEach(paint);
  window.addEventListener('resize', onResize, { passive: true });
  new MutationObserver((_, obs) => { if (!root.isConnected) { window.removeEventListener('resize', onResize); obs.disconnect(); } })
    .observe(document.getElementById('app'), { childList: true, subtree: true });

  root.addEventListener('input', (e) => {
    const el = e.target;
    const ds = el.dataset;
    if (ds.q === 'client') draft.client = el.value;
    if (ds.q === 'amount') draft.amount = el.value;
    if (ds.q === 'fileName') {
      const auto = cleanFileName(defaultQuoteName(quoteData()));
      draft.fileName = cleanFileName(el.value) === auto ? '' : el.value;
    }
    if (ds.text !== undefined) draft.services[ds.text].text = el.value;
    if (ds.price !== undefined) draft.services[ds.price].price = el.value;
    if (ds.qtyInput !== undefined) {
      const s = draft.services[ds.qtyInput];
      s.qty = Math.max(1, Math.min(99, parseInt(el.value, 10) || 1));
      const label = root.querySelector(`[data-qty-text="${ds.qtyInput}"]`);
      if (label) label.textContent = rowText(s);
    }
    changed();
  });

  // campo nome file lasciato vuoto → torna al nome automatico
  root.addEventListener('focusout', (e) => {
    if (e.target.dataset?.q !== 'fileName') return;
    if (!cleanFileName(e.target.value)) { draft.fileName = ''; saveDraft(); }
    refreshDerived(root);
  });

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input')) e.target.blur();
  });

  root.addEventListener('click', async (e) => {
    const el = e.target.closest('button');
    if (!el || el.disabled) return;
    const ds = el.dataset;

    if (ds.preset !== undefined) {
      const p = PRESETS[ds.preset];
      const idx = draft.services.findIndex((s) => (p.make ? s.kind === p.kind : s.text === p.text));
      if (idx >= 0) draft.services.splice(idx, 1);
      else if (draft.services.length < MAX_ROWS) draft.services.push(p.make ? { kind: p.kind, qty: p.qty, price: '' } : { kind: 'text', text: p.text, price: '' });
      saveDraft();
      rerender();
      return;
    }
    if ('addFree' in ds) {
      draft.services.push({ kind: 'text', text: '', price: '' });
      saveDraft();
      rerender();
      setTimeout(() => document.querySelector(`[data-text="${draft.services.length - 1}"]`)?.focus(), 30);
      return;
    }
    if (ds.del !== undefined) {
      draft.services.splice(Number(ds.del), 1);
      saveDraft();
      rerender();
      return;
    }
    if (ds.move !== undefined) {
      const i = Number(ds.move);
      const j = i + Number(ds.dir);
      if (j < 0 || j >= draft.services.length) return;
      [draft.services[i], draft.services[j]] = [draft.services[j], draft.services[i]];
      saveDraft();
      rerender();
      return;
    }
    if (ds.qty !== undefined) {
      const s = draft.services[ds.qty];
      s.qty = Math.max(1, Math.min(99, s.qty + Number(ds.delta)));
      root.querySelector(`[data-qty-input="${ds.qty}"]`).value = s.qty;
      root.querySelector(`[data-qty-text="${ds.qty}"]`).textContent = rowText(s);
      changed();
      return;
    }
    if (ds.period !== undefined) {
      draft.period = ds.period;
      el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el));
      changed();
      return;
    }
    if ('fileReset' in ds) {
      draft.fileName = '';
      const input = root.querySelector('[data-q="fileName"]');
      if (input) input.value = cleanFileName(defaultQuoteName(quoteData()));
      changed();
      return;
    }
    if ('previewOpen' in ds) {
      openPreviewSheet();
      return;
    }
    if ('download' in ds || 'share' in ds) {
      const updated = await runExport('share' in ds ? 'share' : 'download', [...root.querySelectorAll('[data-download], [data-share]')]);
      if (updated && root.isConnected) rerender(); // mostra subito il preventivo tra i recenti
      return;
    }
    if ('new' in ds) {
      const dirty = draft.client.trim() || draft.services.length || String(draft.amount).trim();
      const saved = history().some((h) => h.id === draft.id);
      if (dirty && !saved && !(await confirmDialog({ title: 'Nuovo preventivo?', message: 'Il preventivo che stai compilando non è ancora stato scaricato né inviato: verrà cancellato.', confirmText: 'Nuovo', danger: true }))) return;
      draft = emptyDraft();
      saveDraft();
      rerender();
      window.scrollTo(0, 0);
      setTimeout(() => document.getElementById('q-client')?.focus(), 50);
      return;
    }
    if (ds.open) {
      const h = history().find((x) => x.id === ds.open);
      if (!h) return;
      const { savedAt, totalText, file, ...rest } = h;
      draft = { ...emptyDraft(), ...structuredClone(rest) };
      saveDraft();
      rerender();
      window.scrollTo(0, 0);
      toast(`Aperto il preventivo di ${h.client || 'senza nome'}`);
      return;
    }
    if (ds.forget) {
      safeSet(HISTORY_KEY, history().filter((h) => h.id !== ds.forget));
      rerender();
    }
  });
}
