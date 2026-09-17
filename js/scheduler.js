// Date degli interventi di un contratto.
//
// Le date le decidono Nicolas e Martina: la prima è obbligatoria, le altre si mettono
// una alla volta, incastrandole con gli altri lavori. La ripetizione (facoltativa) serve
// solo a PROPORRE le date:
//  mensile      giorni del mese (es. il 5 e il 20), nei mesi scelti
//  settimanale  giorni della settimana (es. il martedì), anche ogni 2, 3 o 4 settimane
// Le date proposte evitano i giorni non lavorativi, i giorni in cui il condominio ha già
// un lavoro e le giornate già piene.
import { parseISO, toISO, daysInMonth } from './utils.js';

/** Da questi interventi in su una giornata è considerata piena */
export const DAY_LIMIT = 4;
/** Di quanti giorni al massimo si sposta una data proposta per non sovrapporla */
const SHIFT = 7;

export const PLAN_KINDS = ['mensile', 'settimanale'];

export function normalizePlan(plan) {
  const p = plan && typeof plan === 'object' ? plan : {};
  const nums = (v, min, max) => [...new Set((Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n >= min && n <= max))].sort((a, b) => a - b);
  return {
    mode: PLAN_KINDS.includes(p.mode) ? p.mode : '',
    days: nums(p.days, 1, 31),
    weekdays: nums(p.weekdays, 0, 6),
    every: [1, 2, 3, 4].includes(Number(p.every)) ? Number(p.every) : 1,
  };
}

/** La ripetizione è completa (modo scelto e almeno un giorno)? */
export function hasRule(plan) {
  const p = normalizePlan(plan);
  return (p.mode === 'mensile' && p.days.length > 0) || (p.mode === 'settimanale' && p.weekdays.length > 0);
}

/** Mesi (anno+mese) coperti dal periodo, in ordine */
export function periodMonths(from, to) {
  const out = [];
  const d = parseISO(from);
  d.setDate(1);
  const end = parseISO(to);
  while (d <= end) {
    out.push({ y: d.getFullYear(), m: d.getMonth() + 1 });
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

/** Le date che la ripetizione produce nel periodo (prima di sistemare festivi e sovrapposizioni) */
export function ruleDates({ plan, from, to, months, anchor = null }) {
  const p = normalizePlan(plan);
  const out = [];
  if (!from || !to || from > to) return out;

  if (p.mode === 'mensile' && p.days.length) {
    for (const { y, m } of periodMonths(from, to)) {
      if (months?.length && !months.includes(m)) continue;
      const last = daysInMonth(y, m);
      for (const day of p.days) {
        const iso = toISO(new Date(y, m - 1, Math.min(day, last)));
        if (iso >= from && iso <= to && !out.includes(iso)) out.push(iso);
      }
    }
    return out.sort();
  }

  if (p.mode === 'settimanale' && p.weekdays.length) {
    // le settimane "ogni N" si contano dalla settimana della data di riferimento (il primo intervento)
    const monday = (iso) => { const d = parseISO(iso); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; };
    const base = monday(anchor || from);
    const start = monday(from);
    const end = parseISO(to);
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 7)) {
      const weeks = Math.round((d - base) / (7 * 86400000));
      if (((weeks % p.every) + p.every) % p.every) continue;
      for (const wd of p.weekdays) {
        const day = new Date(d);
        day.setDate(day.getDate() + ((wd + 6) % 7));
        const iso = toISO(day);
        if (iso < from || iso > to) continue;
        if (months?.length && !months.includes(day.getMonth() + 1)) continue;
        if (!out.includes(iso)) out.push(iso);
      }
    }
    return out.sort();
  }
  return out;
}

function addISO(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** Primo giorno libero vicino a quello voluto (prima dopo, poi prima), o null */
function freeDay(iso, { workDays, load, busyCondo, taken, from, to }) {
  const ok = (day) => {
    if (day < from || day > to) return false;
    if (workDays?.length && !workDays.includes(parseISO(day).getDay())) return false;
    if (taken.has(day) || busyCondo?.has(day)) return false;
    return (load[day] || 0) < DAY_LIMIT;
  };
  if (ok(iso)) return iso;
  for (let k = 1; k <= SHIFT; k++) {
    if (ok(addISO(iso, k))) return addISO(iso, k);
    if (ok(addISO(iso, -k))) return addISO(iso, -k);
  }
  return null;
}

/**
 * Propone le prossime date secondo la ripetizione.
 * @param {object} o
 * @param {object} o.plan       ripetizione (vedi normalizePlan)
 * @param {string} o.from       primo giorno possibile
 * @param {string} o.to         fine contratto
 * @param {number[]} o.months   mesi ammessi
 * @param {number} o.count      quante date servono
 * @param {string} o.anchor     data del primo intervento (per contare le settimane)
 * @param {number[]} o.workDays giorni lavorativi
 * @param {Object<string,number>} o.load   interventi già presenti per giorno (viene aggiornato)
 * @param {Set<string>} o.busyCondo giorni in cui il condominio ha già un lavoro (viene aggiornato)
 * @returns {string[]} date proposte (possono essere meno di count)
 */
export function suggestDates({ plan, from, to, months, count, anchor = null, workDays = [1, 2, 3, 4, 5, 6], load = {}, busyCondo = new Set() }) {
  if (!hasRule(plan) || count <= 0 || !from || !to || from > to) return [];
  const out = [];
  const taken = new Set();
  for (const iso of ruleDates({ plan, from, to, months, anchor })) {
    if (out.length >= count) break;
    const day = freeDay(iso, { workDays, load, busyCondo, taken, from, to });
    if (!day) continue;
    taken.add(day);
    busyCondo.add(day);
    load[day] = (load[day] || 0) + 1;
    out.push(day);
  }
  return out.sort();
}

/** Descrizione in italiano della ripetizione */
export function planLabel(plan) {
  const p = normalizePlan(plan);
  if (p.mode === 'mensile' && p.days.length) return `Il ${p.days.join(', il ')} del mese`;
  if (p.mode === 'settimanale' && p.weekdays.length) {
    const names = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
    const list = [...p.weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => names[d]).join(', ');
    return p.every === 1 ? `Ogni ${list}` : `Ogni ${p.every} settimane: ${list}`;
  }
  return 'Date decise una alla volta';
}
