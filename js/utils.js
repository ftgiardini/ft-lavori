// Utilità generiche: date (sempre stringhe 'YYYY-MM-DD' in ora locale), stagioni, formattazione.

export const MONTHS = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
export const MONTHS_SHORT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
export const MONTH_INITIALS = ['G', 'F', 'M', 'A', 'M', 'G', 'L', 'A', 'S', 'O', 'N', 'D'];
export const WEEKDAYS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
export const WEEKDAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

// Stagioni meteorologiche (quelle che contano per il giardinaggio)
export const SEASONS = [
  { id: 'primavera', name: 'Primavera', months: [3, 4, 5], icon: 'sprout', color: '#48AB33' },
  { id: 'estate', name: 'Estate', months: [6, 7, 8], icon: 'sun', color: '#D99A1E' },
  { id: 'autunno', name: 'Autunno', months: [9, 10, 11], icon: 'leaf', color: '#D9772B' },
  { id: 'inverno', name: 'Inverno', months: [12, 1, 2], icon: 'snow', color: '#5B8DB8' },
];

export function seasonOf(month) {
  return SEASONS.find((s) => s.months.includes(month));
}

export function seasonsFor(months = []) {
  return SEASONS.filter((s) => s.months.some((m) => months.includes(m)));
}

/** Anno "di stagione": l'inverno di dicembre appartiene all'anno successivo (Dic 2026 → Inverno 2027) */
export function currentSeasonRange(iso = todayISO()) {
  const d = parseISO(iso);
  const m = d.getMonth() + 1;
  let y = d.getFullYear();
  const season = seasonOf(m);
  const startMonth = season.months[0];
  if (season.id === 'inverno' && m !== 12) y -= 1;
  const start = new Date(y, startMonth - 1, 1);
  const end = new Date(y, startMonth + 2, 0);
  return { season, from: toISO(start), to: toISO(end), label: `${season.name} ${season.id === 'inverno' ? y + 1 : y}` };
}

export function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const todayISO = () => toISO(new Date());

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** Giorni da a → b (b - a) */
export function diffDays(a, b) {
  return Math.round((parseISO(b) - parseISO(a)) / 86400000);
}

/** Lunedì della settimana */
export function startOfWeek(iso) {
  const d = parseISO(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toISO(d);
}

export function fmtShort(iso) {
  const d = parseISO(iso);
  return `${WEEKDAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()].toLowerCase()}`;
}

export function fmtLong(iso, withYear = false) {
  const d = parseISO(iso);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].toLowerCase()}${withYear ? ' ' + d.getFullYear() : ''}`;
}

export function fmtDateNum(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function relDay(iso) {
  if (!iso) return 'Da programmare';
  const n = diffDays(todayISO(), iso);
  if (n === 0) return 'Oggi';
  if (n === 1) return 'Domani';
  if (n === -1) return 'Ieri';
  return fmtShort(iso);
}

export function fmtTime(ts) {
  const d = new Date(ts);
  return `${toISO(d) === todayISO() ? 'oggi' : fmtShort(toISO(d))} alle ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** [4,5,6,7,8,9,10] → "Apr–Ott"; gestisce periodi a cavallo d'anno (Nov–Mar) */
export function monthsLabel(months = []) {
  const set = [...new Set(months)].sort((a, b) => a - b);
  if (!set.length) return 'Nessun mese';
  if (set.length === 12) return "Tutto l'anno";
  if (set.length === 1) return MONTHS[set[0] - 1];
  const starts = set.filter((m) => !set.includes(m === 1 ? 12 : m - 1));
  if (starts.length === 1) {
    const start = starts[0];
    const end = start + set.length - 1;
    return `${MONTHS_SHORT[start - 1]}–${MONTHS_SHORT[(end - 1) % 12]}`;
  }
  return set.map((m) => MONTHS_SHORT[m - 1]).join(', ');
}

/** Quanti giorni ha quel mese (m = 1-12) */
export const daysInMonth = (y, m) => new Date(y, m, 0).getDate();

/** 90 → "1 h 30 min" · 45 → "45 min" · 120 → "2 h" */
export function fmtDuration(minutes) {
  const n = Math.max(0, Math.round(Number(minutes) || 0));
  if (!n) return '';
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function mapsUrl(address) {
  const q = encodeURIComponent(address);
  return isIOS() ? `https://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

export function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}
