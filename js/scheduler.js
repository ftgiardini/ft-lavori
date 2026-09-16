// Come si scelgono i giorni degli interventi di un contratto.
//
// Quattro modi (work.plan.mode):
//  mensile      i giorni del mese decisi da chi inserisce il contratto (es. il 5 e il 20), ripetuti nei mesi scelti
//  settimanale  uno o più giorni della settimana (es. ogni martedì), anche ogni 2 o 3 settimane
//  date         le date scelte una per una sul calendario
//  auto         l'app distribuisce da sola gli interventi nei mesi scelti (come nelle prime versioni)
//
// In tutti i casi i giorni non lavorativi vengono spostati al primo giorno utile e,
// se il giorno è già occupato (stesso condominio o giornata piena), l'intervento slitta
// al giorno libero più vicino: due lavori non si sovrappongono mai.
import { parseISO, toISO, daysInMonth } from './utils.js';

/** Oltre questi interventi in un giorno la giornata è considerata piena */
export const DAY_LIMIT = 4;
/** Di quanti giorni al massimo si può spostare un intervento per non sovrapporlo */
const SHIFT = 7;

export function candidateDays({ from, to, months, workDays }) {
  const out = [];
  const d = parseISO(from);
  const end = parseISO(to);
  while (d <= end) {
    const m = d.getMonth() + 1;
    if ((!months?.length || months.includes(m)) && workDays.includes(d.getDay())) out.push(toISO(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/**
 * @param {object} o
 * @param {string} o.from  primo giorno utile (ISO)
 * @param {string} o.to    fine contratto (ISO)
 * @param {number[]} o.months mesi ammessi 1-12
 * @param {number} o.count numero di interventi da piazzare
 * @param {number[]} o.workDays giorni della settimana (0=dom … 6=sab)
 * @param {Object<string,number>} o.load carico già presente per giorno (viene aggiornato)
 * @returns {string[]} date ISO ordinate (può contenerne meno di count se non ci sono giorni utili)
 */
export function planDates({ from, to, months, count, workDays = [1, 2, 3, 4, 5], load = {} }) {
  if (count <= 0 || from > to) return [];
  const days = candidateDays({ from, to, months, workDays });
  const L = days.length;
  if (!L) return [];

  const step = L / count;
  const radius = Math.max(0, Math.min(3, Math.floor(step / 2) - 1));
  const used = new Set();
  const out = [];

  for (let i = 0; i < count; i++) {
    const target = Math.min(L - 1, Math.floor((i + 0.5) * step));
    let best = target;
    let bestScore = Infinity;
    for (let k = -radius; k <= radius; k++) {
      const j = target + k;
      if (j < 0 || j >= L) continue;
      if (count <= L && used.has(days[j])) continue;
      const score = (load[days[j]] || 0) * 10 + Math.abs(k);
      if (score < bestScore) { bestScore = score; best = j; }
    }
    const iso = days[best];
    used.add(iso);
    load[iso] = (load[iso] || 0) + 1;
    out.push(iso);
  }
  return out.sort();
}

/** Mesi (anno+mese) coperti dal periodo, in ordine: per le anteprime */
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

// ---------- Giorni scelti a mano ----------

export function normalizePlan(plan) {
  const p = plan && typeof plan === 'object' ? plan : {};
  const nums = (v, min, max) => [...new Set((Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n >= min && n <= max))].sort((a, b) => a - b);
  return {
    mode: ['mensile', 'settimanale', 'date', 'auto'].includes(p.mode) ? p.mode : 'auto',
    days: nums(p.days, 1, 31),
    weekdays: nums(p.weekdays, 0, 6),
    every: [1, 2, 3, 4].includes(Number(p.every)) ? Number(p.every) : 1,
    dates: [...new Set((Array.isArray(p.dates) ? p.dates : []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort(),
    avoidClash: p.avoidClash !== false,
  };
}

/** Le date che la regola produce nel periodo, prima di sistemare giorni festivi e sovrapposizioni */
export function ruleDates({ plan, from, to, months }) {
  const p = normalizePlan(plan);
  const out = [];
  if (p.mode === 'date') return p.dates.filter((d) => d >= from && d <= to);

  if (p.mode === 'mensile') {
    if (!p.days.length) return [];
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

  if (p.mode === 'settimanale') {
    if (!p.weekdays.length) return [];
    // si parte dal lunedì della settimana del primo giorno utile
    const start = parseISO(from);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const end = parseISO(to);
    let week = 0;
    for (const d = start; d <= end; d.setDate(d.getDate() + 7), week++) {
      if (week % p.every) continue;
      for (const wd of p.weekdays) {
        const day = new Date(d);
        day.setDate(day.getDate() + ((wd + 6) % 7)); // lunedì = primo giorno della settimana
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

/**
 * Sposta una data finché non è libera: giorno lavorativo, senza altri lavori
 * dello stesso condominio e senza giornate piene.
 * @returns {string|null} la data buona, oppure null se non se ne trova una vicina
 */
function freeDay(iso, { workDays, load, busyCondo, taken, from, to, avoidClash, anyDay }) {
  const ok = (day) => {
    if (day < from || day > to) return false;
    // le date scelte una per una valgono anche di domenica: le ha decise una persona
    if (!anyDay && workDays?.length && !workDays.includes(parseISO(day).getDay())) return false;
    if (taken.has(day)) return false;
    if (!avoidClash) return true;
    if (busyCondo?.has(day)) return false;
    return (load[day] || 0) < DAY_LIMIT;
  };
  if (ok(iso)) return iso;
  // prima si prova nei giorni successivi (un lavoro si fa dopo, non prima), poi in quelli precedenti
  for (let k = 1; k <= SHIFT; k++) {
    const after = addISO(iso, k);
    if (ok(after)) return after;
    const before = addISO(iso, -k);
    if (ok(before)) return before;
  }
  return null;
}

function addISO(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/**
 * Le date di un lavoro del contratto, secondo la regola scelta.
 * @param {object} o
 * @param {object} o.plan     regola (vedi normalizePlan)
 * @param {string} o.from     primo giorno utile
 * @param {string} o.to       fine contratto
 * @param {number[]} o.months mesi ammessi
 * @param {number} o.count    quanti interventi servono ancora
 * @param {number[]} o.workDays giorni lavorativi
 * @param {Object<string,number>} o.load carico per giorno (viene aggiornato)
 * @param {Set<string>} o.busyCondo giorni in cui il condominio ha già un lavoro (viene aggiornato)
 * @returns {{dates: string[], moved: Array<{from: string, to: string}>, extra: number}}
 *  dates: le date trovate · moved: gli spostamenti fatti per non sovrapporre · extra: date della regola avanzate
 */
export function planWork({ plan, from, to, months, count, workDays = [1, 2, 3, 4, 5, 6], load = {}, busyCondo = new Set() }) {
  const p = normalizePlan(plan);
  if (count <= 0 || from > to) return { dates: [], moved: [], extra: 0 };

  if (p.mode === 'auto') {
    const dates = planDates({ from, to, months, count, workDays, load });
    for (const d of dates) busyCondo.add(d);
    return { dates, moved: [], extra: 0 };
  }

  const wanted = ruleDates({ plan: p, from, to, months });
  const dates = [];
  const moved = [];
  const taken = new Set();
  for (const iso of wanted) {
    if (dates.length >= count) break;
    const day = freeDay(iso, { workDays, load, busyCondo, taken, from, to, avoidClash: p.avoidClash, anyDay: p.mode === 'date' });
    if (!day) continue;
    if (day !== iso) moved.push({ from: iso, to: day });
    taken.add(day);
    busyCondo.add(day);
    load[day] = (load[day] || 0) + 1;
    dates.push(day);
  }
  return { dates: dates.sort(), moved, extra: Math.max(0, wanted.length - dates.length) };
}

/** Descrizione in italiano della regola, per le schede e le anteprime */
export function planLabel(plan) {
  const p = normalizePlan(plan);
  if (p.mode === 'date') return p.dates.length ? `${p.dates.length} date scelte a mano` : 'Nessuna data scelta';
  if (p.mode === 'mensile') {
    if (!p.days.length) return 'Giorni del mese da scegliere';
    return `Il ${p.days.join(', il ')} di ogni mese`;
  }
  if (p.mode === 'settimanale') {
    if (!p.weekdays.length) return 'Giorni della settimana da scegliere';
    const names = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
    const list = [...p.weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => names[d]).join(', ');
    return p.every === 1 ? `Ogni ${list}` : `Ogni ${p.every} settimane: ${list}`;
  }
  return 'Giorni scelti dall’app nei mesi previsti';
}
