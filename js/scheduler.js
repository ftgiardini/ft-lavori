// Pianificazione automatica: distribuisce N interventi in modo uniforme
// nei mesi previsti dal contratto, solo nei giorni lavorativi,
// preferendo i giorni meno carichi di lavoro.
import { parseISO, toISO } from './utils.js';

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
