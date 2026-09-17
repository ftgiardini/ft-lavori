// Nuovo condominio / modifica: procedura guidata in 3 passi.
// 1 Contratto (PDF, testo o a mano) → 2 Dati, squadra, lavori e date → 3 Riepilogo.
// Per ogni lavoro la data del 1° intervento è obbligatoria; gli altri si possono lasciare
// "da programmare" e mettere in calendario più avanti, uno alla volta.
import * as store from '../store.js';
import { icon } from '../icons.js';
import { rerender, toast, openSheet } from '../ui.js';
import { typeIcon, avatar, daysLabel } from '../components.js';
import { pdfToText, parseContract } from '../contract-parser.js';
import { normalizePlan, planLabel, hasRule, suggestDates, DAY_LIMIT } from '../scheduler.js';
import { WORK_COLORS, PLAN_MODES, DEFAULT_PLAN } from '../data.js';
import { esc, todayISO, parseISO, toISO, fmtLong, fmtShort, fmtDateNum, MONTH_INITIALS, MONTHS_SHORT, WEEKDAYS_SHORT, plural } from '../utils.js';

const STEPS = ['Contratto', 'Dati e lavori', 'Riepilogo'];
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

/** Riga del modulo per un tipo di lavoro (con i dati del contratto e le date degli interventi, se ci sono già) */
function newWork(type, w) {
  if (!w) return { typeId: type.id, qty: 0, months: [...type.months], doneBefore: 0, notes: '', plan: { ...DEFAULT_PLAN }, slots: [], doneDates: [] };
  return {
    id: w.id, typeId: type.id, qty: w.qty, months: [...w.months], doneBefore: w.doneBefore || 0, notes: w.notes || '',
    plan: normalizePlan(w.plan),
    slots: store.pendingJobsOf(w.id).map((j) => ({ jobId: j.id, date: j.date || '' })),
    doneDates: store.doneJobsOf(w.id).map((j) => j.date),
  };
}

/** Tiene il numero di righe-data uguale agli interventi ancora da fare */
function syncSlots(w) {
  const target = Math.max(0, w.qty - w.doneDates.length - (w.doneBefore || 0));
  while (w.slots.length < target) w.slots.push({ date: '' });
  while (w.slots.length > target) {
    // prima si tolgono le righe vuote, partendo dal fondo
    let i = -1;
    for (let k = w.slots.length - 1; k >= 0; k--) if (!w.slots[k].date) { i = k; break; }
    w.slots.splice(i >= 0 ? i : w.slots.length - 1, 1);
  }
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
      ${d.parsed && d.step > 0 && d.step < LAST ? `<div class="plan-warn ok" style="margin:0 0 14px">${icon('sparkles')}<span>Dati letti dal contratto: <b>controlla</b> che siano corretti e completa quelli mancanti.</span></div>` : ''}
      ${body}
      ${d.step > 0 ? `
      <div class="wiz-foot">
        ${d.step > firstStep ? `<button class="btn btn-ghost" data-go="-1">${icon('left')}Indietro</button>` : ''}
        ${d.step < LAST ? `<button class="btn btn-primary" data-go="1">Avanti${icon('right')}</button>` : `<button class="btn btn-primary" data-save>${icon('check')}${editing ? 'Salva modifiche' : 'Salva il condominio'}</button>`}
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
        <span class="grow"><strong>Carica il contratto PDF <span class="tag">AUTO</span></strong><small>L'app legge il contratto e propone lavori e quantità</small></span>
        ${icon('right')}
      </label>
      <button class="option ${d.mode === 'text' ? 'featured' : ''}" data-mode="text">
        <span class="option-ic">${icon('file')}</span>
        <span class="grow"><strong>Incolla il testo del contratto</strong><small>Da Word, da un'email o da un altro documento</small></span>
        ${icon('right')}
      </button>
      <button class="option" data-mode="manual">
        <span class="option-ic">${icon('edit')}</span>
        <span class="grow"><strong>Compila a mano</strong><small>Scegli tu lavori, quantità e date</small></span>
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
    syncSlots(w);
  }
  d.open = d.works.findIndex((w) => w.qty > 0);
  d.parsed = true;
  d.parseError = '';
  d.step = 1;
  toast(`Trovati ${plural(found.length, 'lavoro', 'lavori')} nel contratto: ora inserisci la data del primo intervento`);
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
        ${input('contractStart', 'Dal', 'type="date" data-period')}
        ${input('contractEnd', 'Al', 'type="date" data-period')}
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

// ---------- Passo 2: lavori e date ----------

/** Tutte le date già scelte nel modulo (tutti i lavori), con il lavoro a cui appartengono */
function draftDates() {
  const out = [];
  draft.works.forEach((w, wi) => {
    if (w.qty <= 0) return;
    w.slots.forEach((s, si) => { if (s.date) out.push({ date: s.date, wi, si }); });
    w.doneDates.forEach((dt) => out.push({ date: dt, wi, si: -1 }));
  });
  return out;
}

/** Avvisi su una data: stesso giorno di un altro lavoro di questo condominio, giornata piena */
function dateWarnings(date, wi, si) {
  if (!date) return '';
  const d = draft;
  const notes = [];
  if (date < d.data.contractStart || date > d.data.contractEnd) notes.push('<span class="is-red-text">fuori dal periodo del contratto</span>');
  const same = draftDates().filter((x) => x.date === date && !(x.wi === wi && x.si === si));
  if (same.length) {
    const names = [...new Set(same.map((x) => store.typeById(d.works[x.wi].typeId).name))];
    notes.push(`stesso giorno di ${esc(names.join(', '))}`);
  }
  const others = store.dayAgenda(date).jobs.filter((j) => j.condoId !== d.id);
  const events = store.dayAgenda(date).events;
  if (others.length >= DAY_LIMIT) notes.push(`<b>giornata piena</b>: già ${others.length} lavori`);
  else if (others.length) notes.push(`quel giorno ${plural(others.length, 'altro lavoro', 'altri lavori')}`);
  if (events.length) notes.push(plural(events.length, 'appuntamento', 'appuntamenti'));
  if (d.data.contractStart && parseISO(date).getDay() === 0) notes.push('è domenica');
  return notes.length ? `<span class="slot-warn">${icon('alert')}${notes.join(' · ')}</span>` : '';
}

function datesEditor(w, wi) {
  const t = todayISO();
  const doneN = w.doneDates.length + (w.doneBefore || 0);
  const firstRequired = w.doneDates.length === 0;
  const empty = w.slots.filter((s) => !s.date).length;
  const hasFirst = w.slots.some((s) => s.date);
  const canSuggest = hasRule(w.plan) && empty > 0 && (hasFirst || !firstRequired);
  let n = doneN;
  return `
    <span class="label">Date degli interventi</span>
    <p class="hint" style="margin:2px 0 10px">${firstRequired ? '<b>La data del 1° intervento è obbligatoria.</b> ' : ''}Le altre puoi lasciarle vuote: restano “da programmare” e le mettete in calendario più avanti, una alla volta.
      <br>Interventi <b>già fatti</b>? Metti la loro data (anche passata) e lascia la spunta “già fatto”: così l’app sa quanti ne mancano.</p>
    <div class="slots">
      ${w.doneBefore ? `<div class="slot done"><span class="slot-n">1–${w.doneBefore}</span><span class="grow small">fatti prima di usare l’app</span></div>` : ''}
      ${w.doneDates.map((dt, k) => `<div class="slot done"><span class="slot-n">${(w.doneBefore || 0) + k + 1}°</span><span class="grow small">${icon('check')} fatto ${dt ? `il ${esc(fmtDateNum(dt))}` : ''}</span></div>`).join('')}
      ${w.slots.map((s, si) => {
        n++;
        const required = firstRequired && si === 0;
        const canBeDone = s.date && s.date <= t;
        return `
        <div class="slot ${s.date ? 'set' : ''} ${s.done && canBeDone ? 'past' : ''} ${required && !s.date ? 'required' : ''}">
          <label class="slot-n" for="slot-${wi}-${si}">${n}°${required ? ' *' : ''}</label>
          <div class="grow" style="min-width:0">
            <input id="slot-${wi}-${si}" class="input slot-input" type="date" value="${esc(s.date)}" max="${esc(draft.data.contractEnd || '')}" data-slot="${wi}:${si}">
            ${canBeDone ? `
            <label class="slot-done"><input type="checkbox" data-slot-done="${wi}:${si}" ${s.done ? 'checked' : ''}> già fatto in questa data</label>` : ''}
            ${s.date ? (s.done && canBeDone ? '' : dateWarnings(s.date, wi, si)) : `<span class="slot-hint">${required ? 'obbligatoria' : 'da programmare più avanti'}</span>`}
            ${canBeDone && !s.done && s.date < t ? '<span class="slot-warn">data passata: se non è stato fatto risulterà in ritardo</span>' : ''}
          </div>
          ${s.date ? `<button class="icon-btn" data-clear-slot="${wi}:${si}" aria-label="Togli la data">${icon('x')}</button>` : ''}
        </div>`;
      }).join('')}
    </div>
    ${canSuggest ? `<button class="btn btn-soft btn-block btn-sm" style="margin-top:10px" data-suggest="${wi}">${icon('sparkles')}Proponi le altre ${empty} date con la ripetizione</button>` : ''}`;
}

function ruleEditor(w, wi) {
  const p = w.plan;
  const type = store.typeById(w.typeId);
  return `
    <span class="label">Ripetizione <span class="muted">(facoltativa)</span></span>
    <p class="hint" style="margin:2px 0 8px">Serve all’app per proporre le date degli interventi successivi.</p>
    <div class="plan-modes">
      ${PLAN_MODES.map((m) => `<button class="${p.mode === m.id ? 'on' : ''}" data-plan-mode="${m.id}" data-work="${wi}"><b>${m.label}</b><small>${m.hint}</small></button>`).join('')}
    </div>
    ${p.mode === 'mensile' ? `
      <span class="label" style="margin-top:12px;display:block">Che giorni del mese</span>
      <div class="daygrid" style="--c:${type.color};margin-top:8px">
        ${Array.from({ length: 31 }, (_, k) => `<button class="${p.days.includes(k + 1) ? 'on' : ''}" data-day-month="${k + 1}" data-work="${wi}">${k + 1}</button>`).join('')}
      </div>` : ''}
    ${p.mode === 'settimanale' ? `
      <span class="label" style="margin-top:12px;display:block">Che giorni della settimana</span>
      <div class="pick" style="margin-top:8px">
        ${[1, 2, 3, 4, 5, 6, 0].map((wd) => `<button class="${p.weekdays.includes(wd) ? 'on' : ''}" data-weekday="${wd}" data-work="${wi}">${WEEKDAYS_SHORT[wd]}</button>`).join('')}
      </div>
      <div class="seg" style="margin-top:10px">
        ${[[1, 'Ogni settimana'], [2, 'Ogni 2'], [3, 'Ogni 3'], [4, 'Ogni 4']].map(([k, l]) => `<button class="${p.every === k ? 'on' : ''}" data-every="${k}" data-work="${wi}">${l}</button>`).join('')}
      </div>` : ''}
    ${p.mode ? `
      <span class="label" style="margin-top:14px;display:block">In quali mesi</span>
      <div class="months" style="--c:${type.color};margin-top:8px">
        ${MONTH_INITIALS.map((l, m) => `<button class="${w.months.includes(m + 1) ? 'on' : ''}" data-month="${m + 1}" data-work="${wi}" aria-label="${MONTHS_SHORT[m]}">${l}<small>${MONTHS_SHORT[m]}</small></button>`).join('')}
      </div>` : ''}`;
}

function stepWorks() {
  const d = draft;
  const pastStart = d.data.contractStart < todayISO();
  const active = d.works.filter((w) => w.qty > 0).length;

  return `
    <div class="works-head" id="lavori">
      <h2>Lavori da fare e date</h2>
      <p class="small muted">Per ogni lavoro del contratto tocca <b class="strong">+</b> fino al numero di volte (es. 10 sfalci), poi inserisci <b class="strong">la data del 1° intervento</b>. ${active ? `<b class="strong">${plural(active, 'lavoro inserito', 'lavori inseriti')}</b>` : ''}</p>
    </div>
    ${!d.works.length ? `<div class="plan-warn">${icon('alert')}<span>Elenco dei lavori non ancora disponibile: controlla la connessione.</span></div>` : ''}
    ${d.works.map((w, i) => {
      const type = store.typeById(w.typeId);
      const on = w.qty > 0;
      const open = on && d.open === i;
      const today = todayISO();
      const pastDone = w.slots.filter((s) => s.done && s.date && s.date <= today).length;
      const set = w.slots.filter((s) => s.date).length - pastDone;
      const doneAll = pastDone + w.doneDates.length + (w.doneBefore || 0);
      const missingFirst = on && !w.doneDates.length && w.slots.length && !set && !pastDone;
      const badge = w.found ? (w.qtyFound ? `<span class="found">${icon('sparkles')}Dal contratto</span>` : `<span class="found warn">${icon('alert')}Controlla quantità</span>`) : '';
      return `
      <div class="work-edit ${on ? 'on' : ''}" style="--c:${type.color}">
        <div class="work-edit-top">
          ${typeIcon(type, 'sm')}
          <div class="grow">
            <strong>${esc(type.name)}</strong> ${badge}
            <div class="small muted">${on
              ? `${plural(w.qty, 'volta', 'volte')}${doneAll ? ` · ${doneAll} già fatti` : ''} · ${set} in calendario${w.slots.length - set - pastDone ? ` · ${w.slots.length - set - pastDone} da programmare` : ''}`
              : 'Non previsto · tocca +'}</div>
          </div>
          <div class="stepper">
            <button data-qty="${i}" data-delta="-1" aria-label="Meno">${icon('minus')}</button>
            <input type="number" inputmode="numeric" min="0" max="200" value="${w.qty}" data-qty-input="${i}" aria-label="Quantità ${esc(type.name)}">
            <button data-qty="${i}" data-delta="1" aria-label="Più">${icon('plus')}</button>
          </div>
        </div>
        ${on ? `
        <button class="work-toggle ${missingFirst ? 'is-missing' : ''}" data-open="${i}">${icon(open ? 'up' : 'down')}${open ? 'Chiudi' : missingFirst ? 'Inserisci la data del 1° intervento' : 'Date e ripetizione'}<span class="grow"></span><span class="small muted">${esc(planLabel(w.plan))}</span></button>` : ''}
        ${open ? `
        <div class="work-edit-more">
          ${datesEditor(w, i)}
          <div class="divider"></div>
          ${ruleEditor(w, i)}
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

// ---------- Passo 3: riepilogo ----------

function stepPreview() {
  const d = draft;
  const works = d.works.filter((w) => w.qty > 0);
  const t = todayISO();
  const isPast = (s) => s.done && s.date && s.date <= t;
  const planned = works.reduce((a, w) => a + w.slots.filter((s) => s.date && !isPast(s)).length, 0);
  const pastN = works.reduce((a, w) => a + w.slots.filter(isPast).length, 0);
  const open = works.reduce((a, w) => a + w.slots.filter((s) => !s.date).length, 0);

  return `
    <div class="card">
      <div class="row">
        <span class="option-ic">${icon('calendar')}</span>
        <div class="grow">
          <strong class="strong" style="font-size:17px">${pastN ? `${pastN} già fatti · ` : ''}${plural(planned, 'intervento', 'interventi')} in calendario${open ? ` · ${open} da programmare` : ''}</strong>
          <p class="small muted">Contratto dal ${fmtLong(d.data.contractStart, true)} al ${fmtLong(d.data.contractEnd, true)}</p>
        </div>
      </div>
    </div>
    <div class="section">
      ${works.map((w) => {
        const type = store.typeById(w.typeId);
        const past = w.slots.filter(isPast).map((s) => s.date).sort();
        const dated = w.slots.filter((s) => s.date && !isPast(s)).map((s) => s.date).sort();
        const left = w.slots.filter((s) => !s.date).length;
        return `
        <div class="card plan-days" style="--c:${type.color}">
          <div class="row">
            ${typeIcon(type, 'sm')}
            <div class="grow">
              <strong>${esc(type.name)}</strong>
              <div class="small muted">${plural(w.qty, 'volta', 'volte')} · ${esc(planLabel(w.plan))}</div>
            </div>
          </div>
          <div class="date-chips">
            ${w.doneDates.length || w.doneBefore ? `<span class="date-chip">${icon('check')} ${w.doneDates.length + (w.doneBefore || 0)} già fatti</span>` : ''}
            ${past.map((x) => `<span class="date-chip">${icon('check')} fatto ${esc(fmtShort(x))}</span>`).join('')}
            ${dated.map((x) => `<span class="date-chip plain">${esc(fmtShort(x))}<small>${parseISO(x).getFullYear()}</small></span>`).join('')}
            ${left ? `<span class="date-chip todo">${icon('clock')} ${left} da programmare</span>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>
    ${open ? `<div class="plan-warn ok">${icon('calendar')}<span>Gli interventi da programmare li trovi nella <b>Home</b> (“Da programmare”) e nella scheda del condominio: li mettete in calendario uno alla volta, vedendo cosa c’è già quel giorno.</span></div>` : ''}`;
}

// ---------- Controlli ----------

function validate() {
  const d = draft;
  if (d.step !== 1) return '';
  if (!d.data.name.trim()) return 'Inserisci il nome del condominio';
  if (!d.data.contractStart || !d.data.contractEnd) return 'Inserisci il periodo del contratto';
  if (d.data.contractEnd < d.data.contractStart) return 'La fine del contratto è prima dell’inizio';
  const active = d.works.filter((w) => w.qty > 0);
  if (!active.length) return 'Inserisci almeno un lavoro da fare (tocca +)';
  for (const w of active) {
    const name = store.typeById(w.typeId).name;
    const at = d.works.indexOf(w);
    if (!w.doneDates.length && w.slots.length && !w.slots.some((s) => s.date)) {
      d.open = at;
      return `Inserisci la data del 1° intervento di ${name}`;
    }
    const outside = w.slots.find((s) => s.date && (s.date < d.data.contractStart || s.date > d.data.contractEnd));
    if (outside) {
      d.open = at;
      return outside.date < d.data.contractStart
        ? `${name}: la data ${fmtDateNum(outside.date)} è prima dell’inizio del contratto: cambia la data “Dal” del contratto`
        : `${name}: la data ${fmtDateNum(outside.date)} è dopo la fine del contratto`;
    }
    if (w.plan.mode === 'mensile' && !w.plan.days.length) { d.open = at; return `${name}: scegli i giorni del mese oppure togli la ripetizione`; }
    if (w.plan.mode === 'settimanale' && !w.plan.weekdays.length) { d.open = at; return `${name}: scegli i giorni della settimana oppure togli la ripetizione`; }
    if (w.plan.mode && !w.months.length) { d.open = at; return `${name}: scegli almeno un mese`; }
  }
  return '';
}

/** Propone le date vuote di un lavoro con la sua ripetizione, evitando i giorni già occupati */
function suggestSlots(wi) {
  const d = draft;
  const w = d.works[wi];
  const dated = w.slots.filter((s) => s.date).map((s) => s.date).sort();
  const all = [...w.doneDates, ...dated].filter(Boolean).sort();
  const t = todayISO();
  let from = d.data.contractStart > t ? d.data.contractStart : t;
  const last = all[all.length - 1];
  if (last) { const nx = parseISO(last); nx.setDate(nx.getDate() + 1); if (toISO(nx) > from) from = toISO(nx); }
  const busyCondo = new Set(draftDates().map((x) => x.date));
  const load = {};
  for (const j of store.getState().jobs) if (j.date && !store.isDone(j) && j.condoId !== d.id) load[j.date] = (load[j.date] || 0) + 1;
  const empty = w.slots.filter((s) => !s.date);
  const dates = suggestDates({
    plan: w.plan, from, to: d.data.contractEnd, months: w.months, count: empty.length, anchor: all[0] || null,
    workDays: store.getState().settings.workDays, load, busyCondo,
  });
  dates.forEach((dt, k) => { empty[k].date = dt; });
  w.slots.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  if (!dates.length) toast('Nessuna data libera con questa ripetizione nel periodo del contratto');
  else if (dates.length < empty.length) toast(`Proposte ${dates.length} date: le altre ${empty.length - dates.length} restano da programmare`);
  else toast(`Proposte ${dates.length} date: controllale e cambiale se serve`);
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
      const w = { ...newWork(type), qty: 1 };
      syncSlots(w);
      draft.works.push(w);
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
  const slotAt = (key) => { const [wi, si] = key.split(':').map(Number); return d.works[wi]?.slots[si]; };

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
      syncSlots(d.works[i]);
      if (d.works[i].qty > 0 && d.open === null) d.open = i;
      rerender();
    }
    if (el.dataset.doneInput !== undefined) {
      const w = d.works[el.dataset.doneInput];
      w.doneBefore = Math.max(0, Math.min(w.qty, Number(el.value) || 0));
      syncSlots(w);
      rerender();
    }
    if (el.dataset.slot) {
      const s = slotAt(el.dataset.slot);
      if (s) {
        s.date = el.value || '';
        // una data passata è di solito un intervento già fatto (si può togliere la spunta)
        s.done = !!s.date && s.date < todayISO();
      }
      rerender();
    }
    if (el.dataset.slotDone) {
      const s = slotAt(el.dataset.slotDone);
      if (s) s.done = el.checked;
      rerender();
    }
    if ('period' in el.dataset) rerender();
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
        if (err) {
          toast(err);
          rerender();
          setTimeout(() => document.querySelector('.slot.required, .work-toggle.is-missing, .work-edit-more')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
          return;
        }
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
      syncSlots(w);
      // il primo lavoro inserito apre subito le date
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
    if (ds.clearSlot) {
      const s = slotAt(ds.clearSlot);
      if (s) { s.date = ''; s.done = false; }
      rerender();
      return;
    }
    if (ds.suggest !== undefined) {
      suggestSlots(Number(ds.suggest));
      rerender();
      return;
    }
    if (ds.planMode) {
      const w = d.works[ds.work];
      // toccando di nuovo la ripetizione scelta la si toglie
      w.plan = { ...w.plan, mode: w.plan.mode === ds.planMode ? '' : ds.planMode };
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
    if (ds.doneBefore !== undefined) {
      const w = d.works[ds.doneBefore];
      w.doneBefore = Math.max(0, Math.min(w.qty, w.doneBefore + Number(ds.delta)));
      syncSlots(w);
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
        const jobs = store.jobsOfCondo(condo.id);
        const doneN = jobs.filter(store.isDone).length;
        const dated = jobs.filter((j) => j.date && !store.isDone(j)).length;
        const openN = jobs.filter((j) => !j.date).length;
        toast(`${condo.name} salvato: ${doneN ? `${doneN} già fatti, ` : ''}${plural(dated, 'intervento', 'interventi')} in calendario${openN ? `, ${openN} da programmare` : ''}`);
        draft = null;
        location.hash = `#/condomini/${condo.id}`;
      }
    }
  });
}

/** Da chiamare quando si esce dal modulo senza salvare */
export function resetForm() { draft = null; }
