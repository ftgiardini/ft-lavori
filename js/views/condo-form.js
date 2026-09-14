// Nuovo condominio / modifica: procedura guidata in 3 passi.
// 1 Contratto (PDF, testo o a mano) → 2 Dati, squadra, lavori e quantità → 3 Anteprima calendario.
import * as store from '../store.js';
import { icon } from '../icons.js';
import { rerender, toast, openSheet } from '../ui.js';
import { typeIcon, avatar, daysLabel } from '../components.js';
import { pdfToText, parseContract } from '../contract-parser.js';
import { planDates, periodMonths } from '../scheduler.js';
import { WORK_COLORS } from '../data.js';
import { esc, todayISO, addDays, parseISO, toISO, monthsLabel, fmtLong, MONTH_INITIALS, MONTHS_SHORT, WEEKDAYS_SHORT, plural } from '../utils.js';

const STEPS = ['Contratto', 'Dati e lavori', 'Calendario'];
const LAST = STEPS.length - 1;
let draft = null;

function oneYearFrom(iso) {
  const d = parseISO(iso);
  d.setFullYear(d.getFullYear() + 1);
  d.setDate(d.getDate() - 1);
  return toISO(d);
}

function initDraft(id) {
  const condo = id ? store.condoById(id) : null;
  const types = store.getState().workTypes;
  const t = todayISO();
  const data = condo
    ? { name: condo.name, address: condo.address, city: condo.city, adminName: condo.adminName, phone: condo.phone, email: condo.email, notes: condo.notes, contractStart: condo.contractStart, contractEnd: condo.contractEnd, team: [...condo.team] }
    : { name: '', address: '', city: '', adminName: '', phone: '', email: '', notes: '', contractStart: t, contractEnd: oneYearFrom(t), team: [] };
  const works = types.map((type) => {
    const w = condo?.works.find((x) => x.typeId === type.id);
    return w
      ? { id: w.id, typeId: type.id, qty: w.qty, months: [...w.months], doneBefore: w.doneBefore || 0, notes: w.notes || '' }
      : { typeId: type.id, qty: 0, months: [...type.months], doneBefore: 0, notes: '' };
  });
  draft = { key: id || 'nuovo', id, step: id ? 1 : 0, mode: null, parsing: false, parseError: '', parsed: false, text: '', data, works };
}

export function renderForm(id) {
  if (!store.can('condomini')) {
    return { title: 'Condominio', html: `<div class="card">Solo Martina e Nicolas possono modificare i condomini.</div>` };
  }
  if (!draft || draft.key !== (id || 'nuovo')) initDraft(id);
  const d = draft;
  // tipi di lavoro arrivati dopo l'apertura del modulo (es. dati online appena scaricati)
  for (const type of store.getState().workTypes) {
    if (!d.works.some((w) => w.typeId === type.id)) d.works.push({ typeId: type.id, qty: 0, months: [...type.months], doneBefore: 0, notes: '' });
  }
  const editing = !!d.id;
  const firstStep = editing ? 1 : 0;
  const stepCount = STEPS.length - firstStep;
  const stepNum = d.step - firstStep + 1;

  let body = '';
  if (d.step === 0) body = stepContract();
  if (d.step === 1) body = stepData() + stepWorks();
  if (d.step === 2) body = stepPreview();

  const html = `
    <div class="wizard">
      <div class="wiz-head">
        <button class="icon-btn" data-cancel aria-label="Chiudi">${icon('x')}</button>
        <div class="grow">
          <h1>${editing ? `Modifica ${esc(d.data.name)}` : 'Nuovo condominio'}</h1>
          <p>Passo ${stepNum} di ${stepCount} · ${STEPS[d.step]}</p>
        </div>
      </div>
      <div class="steps" style="grid-template-columns:repeat(${stepCount},1fr)">
        ${Array.from({ length: stepCount }, (_, i) => `<span class="${i < stepNum ? 'on' : ''}"></span>`).join('')}
      </div>
      ${d.parsed && d.step > 0 && d.step < LAST ?`<div class="plan-warn" style="margin:0 0 14px;background:var(--green-100);color:var(--green-700)">${icon('sparkles')}<span>Dati letti dal contratto: <b>controlla</b> che siano corretti e completa quelli mancanti.</span></div>` : ''}
      ${body}
      ${d.step > 0 ? `
      <div class="wiz-foot">
        ${d.step > firstStep ? `<button class="btn btn-ghost" data-go="-1">${icon('left')}Indietro</button>` : ''}
        ${d.step < LAST ? `<button class="btn btn-primary" data-go="1">Avanti${icon('right')}</button>` : `<button class="btn btn-primary" data-save>${icon('check')}${editing ? 'Salva modifiche' : 'Crea e pianifica'}</button>`}
      </div>` : ''}
    </div>`;

  return { title: editing ? 'Modifica condominio' : 'Nuovo condominio', html, mount };
}

// ---------- Passo 1: contratto ----------

function stepContract() {
  const d = draft;
  return `
    <p class="lead" style="margin-bottom:14px">Come vuoi inserire i lavori previsti dal contratto?</p>
    <div class="options">
      <label class="option featured">
        <input type="file" accept="application/pdf,.pdf" hidden data-pdf>
        <span class="option-ic">${icon('upload')}</span>
        <span class="grow"><strong>Carica il contratto PDF <span class="tag">AUTO</span></strong><small>L'app legge il contratto e propone lavori, quantità e mesi</small></span>
        ${icon('right')}
      </label>
      <button class="option ${d.mode === 'text' ? 'featured' : ''}" data-mode="text">
        <span class="option-ic">${icon('file')}</span>
        <span class="grow"><strong>Incolla il testo del contratto</strong><small>Da Word, da un'email o da un altro documento</small></span>
        ${icon('right')}
      </button>
      <button class="option" data-mode="manual">
        <span class="option-ic">${icon('edit')}</span>
        <span class="grow"><strong>Compila a mano</strong><small>Scegli tu lavori, quantità e mesi</small></span>
        ${icon('right')}
      </button>
    </div>
    ${d.mode === 'text' ? `
      <div class="field parse-box">
        <label for="contract-text">Testo del contratto</label>
        <textarea id="contract-text" class="textarea" rows="8" data-text placeholder="Es. Il servizio comprende n. 10 potature da novembre a marzo, n. 12 tagli dell'erba da aprile a ottobre…">${esc(d.text)}</textarea>
        <button class="btn btn-primary btn-block" data-parse-text>${icon('sparkles')}Leggi il testo</button>
      </div>` : ''}
    ${d.parsing ? `<div class="card row parse-box"><span class="spinner"></span><span>Sto leggendo il contratto…</span></div>` : ''}
    ${d.parseError ? `<div class="plan-warn">${icon('alert')}<span>${d.parseError}</span></div>` : ''}
  `;
}

function applyParsed(result) {
  const d = draft;
  const found = result.works.filter((w) => w.qty > 0);
  if (!found.length) {
    d.parseError = 'Non ho trovato lavori nel contratto. Se il PDF è una scansione o una foto non contiene testo leggibile: in quel caso compila a mano (oppure incolla il testo).';
    return;
  }
  for (const [k, v] of Object.entries(result.meta)) if (v && !d.data[k]) d.data[k] = v;
  if (result.meta.contractStart) d.data.contractStart = result.meta.contractStart;
  if (result.meta.contractEnd) d.data.contractEnd = result.meta.contractEnd;
  for (const f of found) {
    const w = d.works.find((x) => x.typeId === f.typeId);
    if (!w) continue;
    Object.assign(w, { qty: f.qty, months: f.months, found: true, qtyFound: f.qtyFound, monthsFound: f.monthsFound, snippet: f.snippet });
  }
  d.parsed = true;
  d.parseError = '';
  d.step = 1;
  toast(`Trovati ${plural(found.length, 'lavoro', 'lavori')} nel contratto`);
}

// ---------- Passo 2: dati ----------

function stepData() {
  const { data } = draft;
  const team = store.fieldTeam();
  const input = (field, label, attrs = '') => `
    <div class="field"><label for="f-${field}">${label}</label><input id="f-${field}" class="input" data-field="${field}" value="${esc(data[field] || '')}" ${attrs}></div>`;
  return `
    <div class="card">
      ${input('name', 'Nome del condominio *', 'placeholder="Es. Condominio Le Querce" autocomplete="off"')}
      ${input('address', 'Indirizzo', 'placeholder="Via, numero civico" autocomplete="off"')}
      ${input('city', 'Comune', 'placeholder="Es. Bologna" autocomplete="off"')}
    </div>
    <div class="card">
      ${input('adminName', 'Amministratore', 'placeholder="Nome o studio" autocomplete="off"')}
      <div class="field-row" style="margin-top:14px">
        ${input('phone', 'Telefono', 'type="tel" inputmode="tel"')}
        ${input('email', 'Email', 'type="email" inputmode="email"')}
      </div>
    </div>
    <div class="card">
      <span class="label">Periodo del contratto</span>
      <div class="field-row" style="margin-top:8px">
        ${input('contractStart', 'Dal', 'type="date"')}
        ${input('contractEnd', 'Al', 'type="date"')}
      </div>
    </div>
    <div class="card">
      <span class="label">Squadra che segue il condominio</span>
      <p class="small muted" style="margin:2px 0 10px">Riceveranno questi lavori nel loro calendario (si può cambiare per ogni intervento).</p>
      <div class="pick">
        ${team.length ? `<button class="${data.team.length === team.length ? 'on' : ''}" data-team-all>${icon('users')}Tutti</button>` : '<span class="small muted">Nessun giardiniere in squadra.</span>'}
        ${team.map((m) => `<button class="${data.team.includes(m.id) ? 'on' : ''}" data-team="${m.id}">${avatar(m, 'xs')}${esc(m.name)}${daysLabel(m) ? ` <span class="small muted">(${daysLabel(m)})</span>` : ''}</button>`).join('')}
      </div>
    </div>
    <div class="card">
      <div class="field"><label for="f-notes">Note</label><textarea id="f-notes" class="textarea" rows="3" data-field="notes" placeholder="Es. chiavi dal portinaio, accesso dal cortile…">${esc(data.notes || '')}</textarea></div>
    </div>`;
}

// ---------- Passo 3: lavori ----------

function stepWorks() {
  const d = draft;
  const pastStart = d.data.contractStart < todayISO();
  const active = d.works.filter((w) => w.qty > 0).length;
  return `
    <div class="works-head" id="lavori">
      <h2>Lavori da fare e quantità</h2>
      <p class="small muted">Per ogni lavoro previsto dal contratto tocca <b class="strong">+</b> fino al numero di volte (es. 10 sfalci l'anno), poi controlla i mesi. ${active ? `<b class="strong">${plural(active, 'lavoro inserito', 'lavori inseriti')}</b>` : ''}</p>
    </div>
    ${!d.works.length ? `<div class="plan-warn">${icon('alert')}<span>Elenco dei lavori non ancora disponibile: controlla la connessione.</span></div>` : ''}
    ${d.works.map((w, i) => {
      const type = store.typeById(w.typeId);
      const on = w.qty > 0;
      const badge = w.found ? (w.qtyFound ? `<span class="found">${icon('sparkles')}Dal contratto</span>` : `<span class="found warn">${icon('alert')}Controlla quantità</span>`) : '';
      return `
      <div class="work-edit ${on ? 'on' : ''}" style="--c:${type.color}">
        <div class="work-edit-top">
          ${typeIcon(type, 'sm')}
          <div class="grow">
            <strong>${esc(type.name)}</strong> ${badge}
            <div class="small muted">${on ? `${plural(w.qty, 'volta', 'volte')} · ${monthsLabel(w.months)}` : 'Non previsto · tocca +'}</div>
          </div>
          <div class="stepper">
            <button data-qty="${i}" data-delta="-1" aria-label="Meno">${icon('minus')}</button>
            <input type="number" inputmode="numeric" min="0" max="200" value="${w.qty}" data-qty-input="${i}" aria-label="Quantità ${esc(type.name)}">
            <button data-qty="${i}" data-delta="1" aria-label="Più">${icon('plus')}</button>
          </div>
        </div>
        <div class="work-edit-more">
          <span class="label">In quali mesi</span>
          <div class="months" style="--c:${type.color};margin-top:8px">
            ${MONTH_INITIALS.map((l, m) => `<button class="${w.months.includes(m + 1) ? 'on' : ''}" data-month="${m + 1}" data-work="${i}" aria-label="${MONTHS_SHORT[m]}">${l}<small>${MONTHS_SHORT[m]}</small></button>`).join('')}
          </div>
          ${pastStart ? `
          <div class="row-between" style="margin-top:12px">
            <span class="small"><b class="strong">Già fatti</b> prima di usare l'app</span>
            <div class="mini-stepper"><div class="stepper">
              <button data-done-before="${i}" data-delta="-1" aria-label="Meno">${icon('minus')}</button>
              <input type="number" inputmode="numeric" min="0" value="${w.doneBefore}" data-done-input="${i}" aria-label="Già fatti">
              <button data-done-before="${i}" data-delta="1" aria-label="Più">${icon('plus')}</button>
            </div></div>
          </div>` : ''}
          ${w.snippet ? `<p class="snippet">“${esc(w.snippet)}”</p>` : ''}
        </div>
      </div>`;
    }).join('')}
    <button class="btn btn-ghost btn-block" style="margin-top:12px" data-new-type>${icon('plus')}Aggiungi un altro tipo di lavoro</button>`;
}

// ---------- Passo 4: anteprima ----------

function stepPreview() {
  const d = draft;
  const t = todayISO();
  const works = d.works.filter((w) => w.qty > 0);
  const from = d.data.contractStart > t ? d.data.contractStart : t;
  const state = store.getState();
  const load = {};
  for (const j of state.jobs) if (j.date && !store.isDone(j) && j.condoId !== d.id) load[j.date] = (load[j.date] || 0) + 1;

  const rows = works.map((w) => {
    const doneJobs = d.id ? state.jobs.filter((j) => j.workId === w.id && store.isDone(j)).length : 0;
    const toPlan = Math.max(0, w.qty - w.doneBefore - doneJobs);
    const dates = planDates({ from, to: d.data.contractEnd, months: w.months, count: toPlan, workDays: state.settings.workDays, load });
    return { w, type: store.typeById(w.typeId), toPlan, dates };
  });
  const months = periodMonths(d.data.contractStart, d.data.contractEnd);
  const total = rows.reduce((a, r) => a + r.toPlan, 0);
  const missing = rows.filter((r) => r.dates.length < r.toPlan);
  const days = state.settings.workDays.map((x) => WEEKDAYS_SHORT[x]).join(', ');

  return `
    <div class="card">
      <div class="row">
        <span class="option-ic">${icon('sparkles')}</span>
        <div class="grow">
          <strong class="strong" style="font-size:17px">${plural(total, 'intervento', 'interventi')} da mettere in calendario</strong>
          <p class="small muted">Dal ${fmtLong(from)} al ${fmtLong(d.data.contractEnd, true)} · giorni lavorativi: ${days}</p>
        </div>
      </div>
    </div>
    <div class="card">
      <span class="label">Distribuzione nei mesi</span>
      <div class="plan-scroll" style="margin-top:10px">
        <table class="plan-table">
          <thead><tr><th>Lavoro</th>${months.map((m) => `<th>${MONTHS_SHORT[m.m - 1]}</th>`).join('')}<th>Tot</th></tr></thead>
          <tbody>
            ${rows.map((r) => `
              <tr style="--c:${r.type.color}">
                <td>${esc(r.type.name)}</td>
                ${months.map((m) => {
                  const key = `${m.y}-${String(m.m).padStart(2, '0')}`;
                  const n = r.dates.filter((x) => x.startsWith(key)).length;
                  return `<td class="${n ? 'has' : ''}">${n || ''}</td>`;
                }).join('')}
                <td class="total">${r.toPlan}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${missing.length ? `<div class="plan-warn">${icon('alert')}<span>${missing.map((r) => `<b>${esc(r.type.name)}</b>: ${r.toPlan - r.dates.length} senza giorni disponibili nei mesi scelti`).join('<br>')}.<br>Resteranno “senza data” e potrai sceglierla dalla Home.</span></div>` : ''}
      <p class="small muted" style="margin-top:12px">Gli interventi vengono distribuiti in modo regolare e sui giorni meno carichi. Ogni intervento si può poi spostare dal calendario.</p>
    </div>`;
}

// ---------- Eventi ----------

function validate() {
  const d = draft;
  if (d.step === 1) {
    if (!d.data.name.trim()) return 'Inserisci il nome del condominio';
    if (!d.data.contractStart || !d.data.contractEnd) return 'Inserisci il periodo del contratto';
    if (d.data.contractEnd < d.data.contractStart) return 'La fine del contratto è prima dell’inizio';
    const active = d.works.filter((w) => w.qty > 0);
    if (!active.length) return 'Inserisci almeno un lavoro da fare (tocca +)';
    const noMonths = active.find((w) => !w.months.length);
    if (noMonths) return `Scegli almeno un mese per ${store.typeById(noMonths.typeId).name}`;
  }
  return '';
}

function openNewTypeSheet() {
  let color = WORK_COLORS[6];
  const months = new Set([3, 4, 5, 6, 7, 8, 9, 10]);
  const s = openSheet({
    title: 'Nuovo tipo di lavoro',
    body: `
      <div class="field"><label for="nt-name">Nome</label><input id="nt-name" class="input" placeholder="Es. Pulizia tombini" autocomplete="off"></div>
      <div class="field"><span class="label">Colore</span><div class="pick" data-colors>${WORK_COLORS.map((c) => `<button data-color="${c}" class="${c === color ? 'on' : ''}" style="width:38px;padding:0;justify-content:center" aria-label="Colore"><span class="avatar avatar-xs" style="--c:${c}"></span></button>`).join('')}</div></div>
      <div class="field"><span class="label">Mesi di solito</span><div class="months" data-nt-months>${MONTH_INITIALS.map((l, m) => `<button class="${months.has(m + 1) ? 'on' : ''}" data-m="${m + 1}">${l}<small>${MONTHS_SHORT[m]}</small></button>`).join('')}</div></div>`,
    footer: `<button class="btn btn-ghost" data-close>Annulla</button><button class="btn btn-primary" data-ok>${icon('plus')}Aggiungi</button>`,
  });
  s.el.addEventListener('click', (e) => {
    const c = e.target.closest('[data-color]');
    if (c) { color = c.dataset.color; s.el.querySelectorAll('[data-color]').forEach((b) => b.classList.toggle('on', b === c)); }
    const m = e.target.closest('[data-m]');
    if (m) { const n = Number(m.dataset.m); months.has(n) ? months.delete(n) : months.add(n); m.classList.toggle('on'); }
    if (e.target.closest('[data-ok]')) {
      const name = s.el.querySelector('#nt-name').value.trim();
      if (!name) { toast('Scrivi il nome del lavoro'); return; }
      const type = store.saveWorkType({ name, icon: 'tool', color, months: [...months].sort((a, b) => a - b) });
      draft.works.push({ typeId: type.id, qty: 1, months: [...type.months], doneBefore: 0, notes: '' });
      s.close();
      rerender();
    }
  });
}

async function readPdf(file) {
  draft.parsing = true;
  draft.parseError = '';
  rerender();
  try {
    const text = await pdfToText(file);
    draft.text = text;
    applyParsed(parseContract(text, store.getState().workTypes));
  } catch (err) {
    console.error(err);
    draft.parseError = err.message || 'Non sono riuscito a leggere il PDF.';
  }
  draft.parsing = false;
  rerender();
}

function mount(root) {
  const d = draft;

  root.addEventListener('input', (e) => {
    const f = e.target.dataset.field;
    if (f) d.data[f] = e.target.value;
    if ('text' in e.target.dataset) d.text = e.target.value;
  });

  root.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.qtyInput !== undefined) { d.works[el.dataset.qtyInput].qty = Math.max(0, Math.min(200, Number(el.value) || 0)); rerender(); }
    if (el.dataset.doneInput !== undefined) { d.works[el.dataset.doneInput].doneBefore = Math.max(0, Number(el.value) || 0); rerender(); }
    if ('pdf' in el.dataset && el.files?.[0]) readPdf(el.files[0]);
  });

  root.addEventListener('click', (e) => {
    const el = e.target.closest('button, [data-cancel]');
    if (!el) return;
    const ds = el.dataset;

    if ('cancel' in ds) {
      const back = d.id ? `#/condomini/${d.id}` : '#/condomini';
      draft = null;
      location.hash = back;
      return;
    }
    if (ds.mode === 'manual') { d.step = 1; rerender(); return; }
    if (ds.mode === 'text') { d.mode = 'text'; rerender(); setTimeout(() => document.getElementById('contract-text')?.focus(), 50); return; }
    if ('parseText' in ds) {
      if (!d.text.trim()) { toast('Incolla prima il testo del contratto'); return; }
      applyParsed(parseContract(d.text, store.getState().workTypes));
      rerender();
      return;
    }
    if (ds.go) {
      const dir = Number(ds.go);
      if (dir > 0) {
        const err = validate();
        if (err) { toast(err); return; }
      }
      d.step += dir;
      rerender();
      window.scrollTo(0, 0);
      return;
    }
    if (ds.team) {
      d.data.team = d.data.team.includes(ds.team) ? d.data.team.filter((x) => x !== ds.team) : [...d.data.team, ds.team];
      rerender();
      return;
    }
    if ('teamAll' in ds) {
      const all = store.fieldTeam().map((m) => m.id);
      d.data.team = d.data.team.length === all.length ? [] : all;
      rerender();
      return;
    }
    if (ds.qty !== undefined) {
      const w = d.works[ds.qty];
      w.qty = Math.max(0, Math.min(200, w.qty + Number(ds.delta)));
      rerender();
      return;
    }
    if (ds.doneBefore !== undefined) {
      const w = d.works[ds.doneBefore];
      w.doneBefore = Math.max(0, Math.min(w.qty, w.doneBefore + Number(ds.delta)));
      rerender();
      return;
    }
    if (ds.month) {
      const w = d.works[ds.work];
      const m = Number(ds.month);
      w.months = w.months.includes(m) ? w.months.filter((x) => x !== m) : [...w.months, m].sort((a, b) => a - b);
      rerender();
      return;
    }
    if ('newType' in ds) { openNewTypeSheet(); return; }
    if ('save' in ds) {
      const payload = { ...d.data, name: d.data.name.trim(), works: d.works.filter((w) => w.qty > 0) };
      if (d.id) {
        store.updateCondo(d.id, payload);
        toast('Modifiche salvate');
        const id = d.id;
        draft = null;
        location.hash = `#/condomini/${id}`;
      } else {
        const condo = store.createCondo(payload);
        const count = store.jobsOfCondo(condo.id).length;
        toast(`${condo.name} creato: ${plural(count, 'intervento', 'interventi')} in calendario`);
        draft = null;
        location.hash = `#/condomini/${condo.id}`;
      }
    }
  });
}

/** Da chiamare quando si esce dal modulo senza salvare */
export function resetForm() { draft = null; }
