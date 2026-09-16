// Nuovo condominio / modifica: procedura guidata in 3 passi.
// 1 Contratto (PDF, testo o a mano) → 2 Dati, squadra, lavori, quantità e giorni → 3 Anteprima calendario.
import * as store from '../store.js';
import { icon } from '../icons.js';
import { rerender, toast, openSheet } from '../ui.js';
import { typeIcon, avatar, daysLabel } from '../components.js';
import { pdfToText, parseContract } from '../contract-parser.js';
import { periodMonths, normalizePlan, planLabel } from '../scheduler.js';
import { WORK_COLORS, PLAN_MODES, DEFAULT_PLAN } from '../data.js';
import { esc, todayISO, addDays, parseISO, toISO, monthsLabel, fmtLong, fmtShort, MONTH_INITIALS, MONTHS_SHORT, WEEKDAYS_SHORT, plural } from '../utils.js';

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
  const works = types.map((type) => newWork(type, condo?.works.find((x) => x.typeId === type.id)));
  draft = { key: id || 'nuovo', id, step: id ? 1 : 0, mode: null, parsing: false, parseError: '', parsed: false, text: '', data, works, open: null };
}

/** Riga del modulo per un tipo di lavoro (con i dati del contratto, se c'è già) */
function newWork(type, w) {
  return w
    ? { id: w.id, typeId: type.id, qty: w.qty, months: [...w.months], doneBefore: w.doneBefore || 0, notes: w.notes || '', plan: normalizePlan(w.plan) }
    : { typeId: type.id, qty: 0, months: [...type.months], doneBefore: 0, notes: '', plan: { ...DEFAULT_PLAN, days: [], weekdays: [] } };
}

export function renderForm(id) {
  if (!store.can('condomini')) {
    return { title: 'Condominio', html: `<div class="card">Solo Martina e Nicolas possono modificare i condomini.</div>` };
  }
  if (!draft || draft.key !== (id || 'nuovo')) initDraft(id);
  const d = draft;
  // tipi di lavoro arrivati dopo l'apertura del modulo (es. dati online appena scaricati)
  for (const type of store.getState().workTypes) {
    if (!d.works.some((w) => w.typeId === type.id)) d.works.push(newWork(type));
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

function monthsPicker(w, i) {
  const type = store.typeById(w.typeId);
  return `
    <span class="label">In quali mesi</span>
    <div class="months" style="--c:${type.color};margin-top:8px">
      ${MONTH_INITIALS.map((l, m) => `<button class="${w.months.includes(m + 1) ? 'on' : ''}" data-month="${m + 1}" data-work="${i}" aria-label="${MONTHS_SHORT[m]}">${l}<small>${MONTHS_SHORT[m]}</small></button>`).join('')}
    </div>`;
}

/** Scelta dei giorni: del mese, della settimana, date precise oppure automatico */
function planEditor(w, i, found) {
  const p = w.plan;
  const type = store.typeById(w.typeId);
  const dayGrid = `
    <span class="label">Che giorno del mese</span>
    <p class="hint" style="margin:2px 0 8px">Tocca i giorni: si ripetono in tutti i mesi scelti qui sotto. Se cade di domenica o è già occupato, l'intervento slitta al primo giorno utile.</p>
    <div class="daygrid" style="--c:${type.color}">
      ${Array.from({ length: 31 }, (_, k) => `<button class="${p.days.includes(k + 1) ? 'on' : ''}" data-day-month="${k + 1}" data-work="${i}">${k + 1}</button>`).join('')}
    </div>`;

  const weekPick = `
    <span class="label">Che giorno della settimana</span>
    <div class="pick" style="margin-top:8px">
      ${[1, 2, 3, 4, 5, 6, 0].map((wd) => `<button class="${p.weekdays.includes(wd) ? 'on' : ''}" data-weekday="${wd}" data-work="${i}">${WEEKDAYS_SHORT[wd]}</button>`).join('')}
    </div>
    <span class="label" style="margin-top:12px;display:block">Ogni quanto</span>
    <div class="seg" style="margin-top:6px">
      ${[[1, 'Ogni settimana'], [2, 'Ogni 2 settimane'], [3, 'Ogni 3'], [4, 'Ogni 4']].map(([n, l]) => `<button class="${p.every === n ? 'on' : ''}" data-every="${n}" data-work="${i}">${l}</button>`).join('')}
    </div>`;

  const datePick = `
    <span class="label">Le date, una per una</span>
    <div class="row" style="margin-top:8px;gap:8px">
      <input class="input" type="date" data-new-date="${i}" min="${esc(draft.data.contractStart)}" max="${esc(draft.data.contractEnd)}" aria-label="Aggiungi una data">
      <button class="btn btn-soft" data-add-date="${i}">${icon('plus')}Aggiungi</button>
    </div>
    ${p.dates.length ? `<div class="date-chips">${p.dates.map((dt) => `<span class="date-chip">${esc(fmtShort(dt))}<button data-del-date="${esc(dt)}" data-work="${i}" aria-label="Togli ${esc(fmtShort(dt))}">${icon('x')}</button></span>`).join('')}</div>` : '<p class="hint" style="margin-top:8px">Nessuna data scelta.</p>'}`;

  return `
    <span class="label">Quando si fa</span>
    <div class="plan-modes" style="margin:8px 0 12px">
      ${PLAN_MODES.map((m) => `<button class="${p.mode === m.id ? 'on' : ''}" data-plan-mode="${m.id}" data-work="${i}"><b>${m.label}</b><small>${m.hint}</small></button>`).join('')}
    </div>
    ${p.mode === 'mensile' ? dayGrid : ''}
    ${p.mode === 'settimanale' ? weekPick : ''}
    ${p.mode === 'date' ? datePick : ''}
    ${p.mode === 'date' ? '' : `<div style="margin-top:14px">${monthsPicker(w, i)}</div>`}
    ${found?.dates ? `
      <div class="plan-result ${found.dates.length < found.toPlan ? 'warn' : ''}">
        ${icon(found.dates.length < found.toPlan ? 'alert' : 'check')}
        <span>${found.dates.length === found.toPlan
          ? `<b>${plural(found.toPlan, 'intervento', 'interventi')}</b> in calendario: ${found.dates.slice(0, 4).map((x) => esc(fmtShort(x))).join(' · ')}${found.dates.length > 4 ? ` · +${found.dates.length - 4}` : ''}`
          : `Con questi giorni l'app trova <b>${found.dates.length}</b> date su ${found.toPlan}: ${found.dates.length ? 'le altre resteranno “senza data”.' : 'scegli i giorni o allarga i mesi.'}`}</span>
      </div>` : ''}
    ${p.mode === 'auto' ? '' : `
      <label class="check-row" style="margin-top:12px">
        <input type="checkbox" data-avoid="${i}" ${p.avoidClash ? 'checked' : ''}>
        <span><b class="strong">Non sovrapporre i lavori</b><small>Se il giorno è già pieno o c'è già un lavoro in questo condominio, sposta al giorno vicino</small></span>
      </label>`}`;
}

function stepWorks() {
  const d = draft;
  const pastStart = d.data.contractStart < todayISO();
  const activeWorks = d.works.filter((w) => w.qty > 0);
  const active = activeWorks.length;
  // date che verrebbero messe in calendario, così si vede subito l'effetto dei giorni scelti
  let preview = [];
  try {
    preview = store.previewPlan({ ...d.data, works: activeWorks }, d.id);
  } catch { /* periodo non ancora valido */ }
  const foundOf = (w) => preview.find((r) => r.work === w);

  return `
    <div class="works-head" id="lavori">
      <h2>Lavori da fare, quantità e giorni</h2>
      <p class="small muted">Per ogni lavoro del contratto tocca <b class="strong">+</b> fino al numero di volte (es. 10 sfalci l'anno), poi scegli tu <b class="strong">in che giorni</b> si fa. ${active ? `<b class="strong">${plural(active, 'lavoro inserito', 'lavori inseriti')}</b>` : ''}</p>
    </div>
    ${!d.works.length ? `<div class="plan-warn">${icon('alert')}<span>Elenco dei lavori non ancora disponibile: controlla la connessione.</span></div>` : ''}
    ${d.works.map((w, i) => {
      const type = store.typeById(w.typeId);
      const on = w.qty > 0;
      const open = on && d.open === i;
      const badge = w.found ? (w.qtyFound ? `<span class="found">${icon('sparkles')}Dal contratto</span>` : `<span class="found warn">${icon('alert')}Controlla quantità</span>`) : '';
      return `
      <div class="work-edit ${on ? 'on' : ''}" style="--c:${type.color}">
        <div class="work-edit-top">
          ${typeIcon(type, 'sm')}
          <div class="grow">
            <strong>${esc(type.name)}</strong> ${badge}
            <div class="small muted">${on ? `${plural(w.qty, 'volta', 'volte')} · ${esc(planLabel(w.plan))}` : 'Non previsto · tocca +'}</div>
          </div>
          <div class="stepper">
            <button data-qty="${i}" data-delta="-1" aria-label="Meno">${icon('minus')}</button>
            <input type="number" inputmode="numeric" min="0" max="200" value="${w.qty}" data-qty-input="${i}" aria-label="Quantità ${esc(type.name)}">
            <button data-qty="${i}" data-delta="1" aria-label="Più">${icon('plus')}</button>
          </div>
        </div>
        ${on ? `
        <button class="work-toggle" data-open="${i}">${icon(open ? 'up' : 'down')}${open ? 'Chiudi i giorni' : 'Scegli i giorni'}<span class="grow"></span><span class="small muted">${esc(monthsLabel(w.months))}</span></button>` : ''}
        ${open ? `
        <div class="work-edit-more">
          ${planEditor(w, i, foundOf(w))}
          ${pastStart ? `
          <div class="row-between" style="margin-top:14px">
            <span class="small"><b class="strong">Già fatti</b> prima di usare l'app</span>
            <div class="mini-stepper"><div class="stepper">
              <button data-done-before="${i}" data-delta="-1" aria-label="Meno">${icon('minus')}</button>
              <input type="number" inputmode="numeric" min="0" value="${w.doneBefore}" data-done-input="${i}" aria-label="Già fatti">
              <button data-done-before="${i}" data-delta="1" aria-label="Più">${icon('plus')}</button>
            </div></div>
          </div>` : ''}
          ${w.snippet ? `<p class="snippet">“${esc(w.snippet)}”</p>` : ''}
        </div>` : ''}
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

  const rows = store.previewPlan({ ...d.data, works }, d.id).map((r) => ({ ...r, w: r.work, type: store.typeById(r.work.typeId) }));
  const months = periodMonths(d.data.contractStart, d.data.contractEnd);
  const total = rows.reduce((a, r) => a + r.toPlan, 0);
  const missing = rows.filter((r) => r.dates.length < r.toPlan);
  const moved = rows.flatMap((r) => r.moved.map((m) => ({ ...m, type: r.type })));
  const days = state.settings.workDays.map((x) => WEEKDAYS_SHORT[x]).join(', ');

  return `
    <div class="card">
      <div class="row">
        <span class="option-ic">${icon('calendar')}</span>
        <div class="grow">
          <strong class="strong" style="font-size:17px">${plural(total, 'intervento', 'interventi')} da mettere in calendario</strong>
          <p class="small muted">Dal ${fmtLong(from)} al ${fmtLong(d.data.contractEnd, true)} · giorni lavorativi: ${days}</p>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-head"><h2>Giorni scelti</h2></div>
      ${rows.map((r) => `
        <div class="card plan-days" style="--c:${r.type.color}">
          <div class="row">
            ${typeIcon(r.type, 'sm')}
            <div class="grow">
              <strong>${esc(r.type.name)}</strong>
              <div class="small muted">${esc(planLabel(r.w.plan))} · ${plural(r.dates.length, 'data', 'date')}</div>
            </div>
          </div>
          ${r.dates.length ? `<div class="date-chips">${r.dates.map((x) => `<span class="date-chip plain">${esc(fmtShort(x))}<small>${parseISO(x).getFullYear()}</small></span>`).join('')}</div>` : '<p class="small muted" style="margin-top:8px">Nessuna data: resteranno da programmare.</p>'}
        </div>`).join('')}
      ${!rows.length ? '<div class="card"><p class="small muted">Nessun lavoro inserito.</p></div>' : ''}
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
      ${moved.length ? `<div class="plan-warn ok">${icon('redo')}<span>${plural(moved.length, 'intervento spostato', 'interventi spostati')} al giorno libero più vicino per non sovrapporli: ${moved.slice(0, 3).map((m) => `<b>${esc(m.type.name)}</b> dal ${esc(fmtShort(m.from))} al ${esc(fmtShort(m.to))}`).join(', ')}${moved.length > 3 ? '…' : ''}</span></div>` : ''}
      ${missing.length ? `<div class="plan-warn">${icon('alert')}<span>${missing.map((r) => `<b>${esc(r.type.name)}</b>: ${r.toPlan - r.dates.length} senza giorno disponibile`).join('<br>')}.<br>Resteranno “senza data” e potrai sceglierla dalla Home o dal calendario.</span></div>` : ''}
      <p class="small muted" style="margin-top:12px">Ogni intervento si può comunque spostare dal calendario, anche uno per volta.</p>
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
    const noMonths = active.find((w) => w.plan.mode !== 'date' && !w.months.length);
    if (noMonths) return `Scegli almeno un mese per ${store.typeById(noMonths.typeId).name}`;
    const noDays = active.find((w) => (w.plan.mode === 'mensile' && !w.plan.days.length)
      || (w.plan.mode === 'settimanale' && !w.plan.weekdays.length)
      || (w.plan.mode === 'date' && !w.plan.dates.length));
    if (noDays) {
      d.open = d.works.indexOf(noDays);
      return `Scegli i giorni per ${store.typeById(noDays.typeId).name} (oppure “Sceglie l’app”)`;
    }
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
      draft.works.push({ ...newWork(type), qty: 1 });
      draft.open = draft.works.length - 1;
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
    if (el.dataset.qtyInput !== undefined) {
      const i = Number(el.dataset.qtyInput);
      d.works[i].qty = Math.max(0, Math.min(200, Number(el.value) || 0));
      if (d.works[i].qty > 0 && d.open === null) d.open = i;
      rerender();
    }
    if (el.dataset.doneInput !== undefined) { d.works[el.dataset.doneInput].doneBefore = Math.max(0, Number(el.value) || 0); rerender(); }
    if (el.dataset.avoid !== undefined) { d.works[el.dataset.avoid].plan.avoidClash = el.checked; rerender(); }
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
      const i = Number(ds.qty);
      const w = d.works[i];
      w.qty = Math.max(0, Math.min(200, w.qty + Number(ds.delta)));
      // il primo lavoro inserito apre subito la scelta dei giorni
      if (w.qty > 0 && d.open === null) d.open = i;
      if (!w.qty && d.open === i) d.open = null;
      rerender();
      return;
    }
    if (ds.open !== undefined) {
      const i = Number(ds.open);
      d.open = d.open === i ? null : i;
      rerender();
      return;
    }
    if (ds.planMode) {
      const w = d.works[ds.work];
      w.plan = { ...w.plan, mode: ds.planMode };
      rerender();
      return;
    }
    if (ds.dayMonth) {
      const w = d.works[ds.work];
      const n = Number(ds.dayMonth);
      w.plan.days = w.plan.days.includes(n) ? w.plan.days.filter((x) => x !== n) : [...w.plan.days, n].sort((a, b) => a - b);
      rerender();
      return;
    }
    if (ds.weekday !== undefined) {
      const w = d.works[ds.work];
      const n = Number(ds.weekday);
      w.plan.weekdays = w.plan.weekdays.includes(n) ? w.plan.weekdays.filter((x) => x !== n) : [...w.plan.weekdays, n].sort((a, b) => a - b);
      rerender();
      return;
    }
    if (ds.every) {
      d.works[ds.work].plan.every = Number(ds.every);
      rerender();
      return;
    }
    if (ds.addDate !== undefined) {
      const i = Number(ds.addDate);
      const input = root.querySelector(`[data-new-date="${i}"]`);
      const val = input?.value;
      if (!val) { toast('Scegli prima una data'); return; }
      if (val < d.data.contractStart || val > d.data.contractEnd) { toast('La data è fuori dal periodo del contratto'); return; }
      const plan = d.works[i].plan;
      if (!plan.dates.includes(val)) plan.dates = [...plan.dates, val].sort();
      rerender();
      return;
    }
    if (ds.delDate) {
      const plan = d.works[ds.work].plan;
      plan.dates = plan.dates.filter((x) => x !== ds.delDate);
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
