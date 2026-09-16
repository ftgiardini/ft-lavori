// Archivio dati dell'app.
// Due modalità:
//  - ONLINE (Supabase configurato in config.js): dati condivisi tra tutti gli account, accesso con password,
//    aggiornamenti in tempo reale. Una copia resta sul dispositivo per funzionare anche senza campo.
//  - PROVA (config.js vuoto): dati salvati solo su questo dispositivo.
// Le schermate usano sempre le stesse funzioni, qualunque sia la modalità.
import { DEFAULT_WORK_TYPES, DEFAULT_TEAM, ROLES, WORK_TYPES_VERSION } from './data.js';
import { uid, todayISO, parseISO, diffDays, addDays, addMonths } from './utils.js';
import { planWork, normalizePlan } from './scheduler.js';
import * as cloud from './cloud.js';
import { LOGIN_DOMAIN } from './config.js';

const KEY = 'ftg-lavori-dati-v1';
const USER_KEY = 'ftg-lavori-utente';
const CACHE_KEY = 'ftg-lavori-cache-online';
const LOGIN_LIST_KEY = 'ftg-lavori-elenco-accessi';
const listeners = new Set();
let state = null;
let version = 0; // aumenta a ogni modifica locale
let cloudUserId = null;

const clone = (o) => JSON.parse(JSON.stringify(o));
const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { console.warn('Salvataggio non riuscito', e); } };
const safeDel = (k) => { try { localStorage.removeItem(k); } catch { /* niente */ } };

export const DONE = 'fatto';
export const TODO = 'da-fare';
export const isCloud = cloud.enabled;

/** Messaggi da mostrare all'utente (collegato da app.js ai toast) */
let notifyUser = () => {};
export function onMessage(fn) { notifyUser = fn; }

// ---------- Caricamento / salvataggio ----------

export async function load() {
  if (!isCloud) {
    const raw = safeGet(KEY);
    if (raw) {
      try {
        const saved = JSON.parse(raw);
        // condomini finti delle prime bozze: si tolgono UNA SOLA VOLTA (i dati inseriti dopo non vengono mai toccati)
        if (!saved.demoCleaned && (saved.typesVersion || 1) < 2 && saved.condos?.length && saved.condos.every((c) => DEMO_NAMES.includes(c.name))) {
          saved.condos = [];
          saved.jobs = [];
        }
        saved.demoCleaned = true;
        state = normalize(saved);
        save();
        return;
      } catch (e) { console.error('Dati non leggibili, riparto da zero', e); }
    }
    state = normalize({ demoCleaned: true });
    save();
    return;
  }

  state = emptyCloudState();
  cloud.init({
    getState: () => state,
    canManage: () => isAdmin(),
    onRemoteChange: () => { saveCacheSoon(); emit('remote'); },
    onStatus: () => emit('status'),
    onReconnect: () => refresh(),
    onRejected: (err) => {
      notifyUser(err.denied ? 'Modifica non consentita per il tuo ruolo: annullata.' : `Modifica non salvata: ${err.message}`);
      setTimeout(() => refresh({ discardLocal: true }), 0);
    },
  });

  let uid = null;
  try { uid = await cloud.sessionUserId(); } catch (e) { console.warn('Sessione non leggibile', e); }
  if (uid) await startSession(uid);
  else refreshLoginList();

  window.addEventListener('online', () => { if (cloudUserId) refresh(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && cloudUserId) refresh(); });
}

function emptyCloudState() {
  return { settings: { workDays: [1, 2, 3, 4, 5, 6] }, team: [], workTypes: [], condos: [], jobs: [], events: [], payments: [] };
}

async function startSession(uid) {
  cloudUserId = uid;
  let cached = null;
  try { cached = JSON.parse(safeGet(CACHE_KEY) || 'null'); } catch { /* cache rovinata */ }
  if (cached?.userId === uid && cached.state) {
    state = { ...emptyCloudState(), ...cached.state };
    cloud.restore(cached.synced);
  } else {
    state = emptyCloudState();
    cloud.reset();
  }
  cloud.subscribeRealtime();
  // con i dati già sul telefono l'app si apre subito e si aggiorna in background
  // senza dati sul telefono non c'è niente da inviare: si scarica e basta
  if (memberById(uid)) refresh();
  else await refresh({ discardLocal: true });
}

/** Invia le modifiche in sospeso e riscarica tutto dal database */
export async function refresh({ discardLocal = false } = {}) {
  if (!isCloud || !cloudUserId) return;
  if (!discardLocal) {
    try { await cloud.push(); } catch { return; } // offline: si riprova più tardi
  }
  const before = version;
  try {
    const data = await cloud.pullAll();
    if (version !== before) { setTimeout(() => refresh(), 500); return; } // modifiche fatte nel frattempo
    state = { ...emptyCloudState(), ...data };
    saveCache();
    emit('remote');
  } catch (e) {
    console.warn('Aggiornamento non riuscito', e);
    emit('status');
  }
}

function saveCache() {
  if (!cloudUserId) return;
  safeSet(CACHE_KEY, JSON.stringify({ userId: cloudUserId, state, synced: cloud.snapshot() }));
}
let cacheTimer = null;
function saveCacheSoon() {
  clearTimeout(cacheTimer);
  cacheTimer = setTimeout(saveCache, 800);
}

/** Stato del salvataggio online, per l'indicatore in alto */
export function syncInfo() {
  if (!isCloud) return { status: 'local', pending: 0 };
  const status = cloud.getStatus();
  return { status, pending: status === 'ok' ? 0 : cloud.pendingCount() };
}

/** Accesso aperto ma dati non caricati (primo accesso senza connessione) */
export const needsData = () => isCloud && !!cloudUserId && !memberById(cloudUserId);

function normalize(s) {
  s.version ??= 1;
  s.settings ??= {};
  s.settings.workDays ??= [1, 2, 3, 4, 5, 6];
  s.team ??= clone(DEFAULT_TEAM);
  s.workTypes ??= clone(DEFAULT_WORK_TYPES);
  s.condos ??= [];
  s.jobs ??= [];
  s.events ??= [];
  s.payments ??= [];
  // nuovo elenco dei lavori: si tengono i vecchi tipi solo se usati in qualche contratto
  if ((s.typesVersion || 1) < WORK_TYPES_VERSION) {
    const used = new Set([...s.condos.flatMap((c) => (c.works || []).map((w) => w.typeId)), ...s.jobs.map((j) => j.typeId)]);
    const fresh = clone(DEFAULT_WORK_TYPES);
    s.workTypes = [...fresh, ...s.workTypes.filter((t) => !fresh.some((f) => f.id === t.id) && used.has(t.id))];
    s.typesVersion = WORK_TYPES_VERSION;
  }
  migrateOldTeam(s);
  // Al posto di Lorenzo ora c'è Tomas: i lavori di Lorenzo passano a Tomas
  if ((s.teamVersion || 1) < 3) {
    const swap = (ids = []) => [...new Set(ids.map((x) => (x === 'lorenzo' ? 'tomas' : x)))];
    s.team = s.team.filter((m) => m.id !== 'lorenzo');
    if (!s.team.some((m) => m.id === 'tomas')) s.team.push(clone(DEFAULT_TEAM.find((m) => m.id === 'tomas')));
    for (const c of s.condos) c.team = swap(c.team);
    for (const j of s.jobs) {
      j.assignees = swap(j.assignees);
      if (j.doneBy === 'lorenzo') j.doneBy = 'tomas';
    }
    s.teamVersion = 3;
  }
  // Alessandro si occupa di scadenze e pagamenti: nuovo livello di accesso e nuova mansione
  if ((s.teamVersion || 1) < 4) {
    const a = s.team.find((m) => m.id === 'alessandro');
    if (a && a.role === 'giardiniere') { a.role = 'amministrazione'; a.title = 'Schiacciapollici'; }
    s.teamVersion = 4;
  }
  if ((s.teamVersion || 1) < 5) {
    const t = s.team.find((m) => m.id === 'tomas');
    if (t && t.name === 'Tomas') t.name = 'Thomas';
    s.teamVersion = 5;
  }
  for (const m of s.team) {
    delete m.pass; // le vecchie impronte delle password non servono più
    // vecchio ruolo unico "admin" → titolare (Nicolas) o ufficio
    if (!ROLES[m.role]) m.role = m.role === 'admin' ? (m.id === 'nicolas' ? 'titolare' : 'ufficio') : 'giardiniere';
  }
  return s;
}

// ---------- Accesso e password ----------

/** Maiuscole e minuscole indifferenti, spazi ignorati */
const cleanPassword = (p) => String(p || '').trim().toUpperCase();
export const MIN_PASSWORD = 6;

/** Persone mostrate nella schermata di accesso */
export function loginTeam() {
  if (!isCloud) return state.team;
  try { return JSON.parse(safeGet(LOGIN_LIST_KEY) || '[]'); } catch { return []; }
}

/** Aggiorna l'elenco della schermata di accesso; restituisce true se è cambiato */
export async function refreshLoginList() {
  if (!isCloud) return false;
  try {
    const list = JSON.stringify(await cloud.fetchLoginList());
    if (list === safeGet(LOGIN_LIST_KEY)) return false;
    safeSet(LOGIN_LIST_KEY, list);
    emit('status');
    return true;
  } catch (e) {
    console.warn('Elenco accessi non disponibile', e);
    return false;
  }
}

/** Accesso: in modalità prova basta scegliere il nome, online serve la password */
export async function login(memberId, password) {
  if (!isCloud) {
    setCurrentUser(memberId);
    return true;
  }
  const m = loginTeam().find((x) => x.id === memberId);
  if (!m?.email) throw new Error('Persona non trovata: ricarica la pagina.');
  const uid = await cloud.signIn(m.email, cleanPassword(password));
  if (!uid) return false;
  await startSession(uid);
  return true;
}

export async function logout() {
  if (!isCloud) { setCurrentUser(null); emit('local'); return; }
  cloudUserId = null;
  await cloud.signOut();
  safeDel(CACHE_KEY);
  state = emptyCloudState();
  refreshLoginList();
  emit('local');
}

/** Ognuno cambia la propria password conoscendo quella attuale */
export async function changeOwnPassword(oldPassword, newPassword) {
  const me = currentUser();
  if (!isCloud || !me) throw new Error('Le password si usano solo nella versione online.');
  if (cleanPassword(newPassword).length < MIN_PASSWORD) throw new Error(`La nuova password deve avere almeno ${MIN_PASSWORD} caratteri.`);
  const ok = await cloud.signIn(me.email, cleanPassword(oldPassword));
  if (!ok) throw new Error('La password attuale non è corretta.');
  await cloud.updatePassword(cleanPassword(newPassword));
}

/** Il titolare imposta una nuova password a qualcuno */
export async function setMemberPassword(memberId, password) {
  if (!isCloud) return;
  if (cleanPassword(password).length < MIN_PASSWORD) throw new Error(`La password deve avere almeno ${MIN_PASSWORD} caratteri.`);
  await cloud.manageUsers({ action: 'set_password', id: memberId, password: cleanPassword(password) });
}

function loginEmail(name) {
  const base = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || 'persona';
  const taken = new Set(state.team.map((m) => (m.email || '').toLowerCase()));
  let email = `${base}@${LOGIN_DOMAIN}`;
  for (let i = 2; taken.has(email); i++) email = `${base}${i}@${LOGIN_DOMAIN}`;
  return email;
}

/** Nuova persona (online crea anche l'accesso con la password) */
export async function createMember(member, password) {
  if (!isCloud) {
    saveMember(member);
    return;
  }
  if (cleanPassword(password).length < MIN_PASSWORD) throw new Error(`La password deve avere almeno ${MIN_PASSWORD} caratteri.`);
  const email = loginEmail(member.name);
  const { id } = await cloud.manageUsers({
    action: 'create',
    email,
    password: cleanPassword(password),
    profile: { name: member.name, title: member.title, role: member.role, field: member.field, color: member.color, days: member.days, sort: state.team.length + 1 },
  });
  await refresh();
  refreshLoginList();
  return { id, email };
}

// La prima bozza aveva nomi inventati (Luca, Davide): li sostituisco con la squadra vera
function migrateOldTeam(s) {
  const map = { luca: 'leonardo', davide: 'lorenzo' };
  if (!s.team.some((m) => map[m.id]) || s.team.some((m) => m.id === 'manuel')) return;
  const swap = (id) => map[id] || id;
  s.team = clone(DEFAULT_TEAM);
  if (s.settings.workDays.join() === '1,2,3,4,5') s.settings.workDays = [1, 2, 3, 4, 5, 6];
  for (const c of s.condos) c.team = [...new Set(c.team.map(swap))];
  for (const j of s.jobs) {
    j.assignees = [...new Set(j.assignees.map(swap))];
    if (j.doneBy) j.doneBy = swap(j.doneBy);
    for (const l of j.log || []) if (l.by) l.by = swap(l.by);
  }
  safeSet(USER_KEY, swap(safeGet(USER_KEY) || '') || '');
}

/** La persona lavora in quel giorno? (es. Manuel solo il sabato) */
export const isAvailable = (member, iso) => !iso || !member?.days?.length || member.days.includes(parseISO(iso).getDay());

/** Squadra del condominio che lavora in quella data */
function defaultAssignees(condo, date) {
  return (condo?.team || []).filter((id) => isAvailable(memberById(id), date));
}

/** Dopo un cambio di data: toglie chi quel giorno non lavora; se non resta nessuno, rimette la squadra del condominio */
function fitAssignees(job) {
  const kept = job.assignees.filter((id) => isAvailable(memberById(id), job.date));
  job.assignees = kept.length ? kept : defaultAssignees(condoById(job.condoId), job.date);
}

function save() { safeSet(KEY, JSON.stringify(state)); }

function emit(source) {
  listeners.forEach((fn) => fn(source));
}

function commit() {
  version++;
  if (isCloud) {
    saveCacheSoon();
    cloud.schedulePush();
  } else {
    save();
  }
  emit('local');
}

/** fn(source): source = 'local' (modifica fatta qui) · 'remote' (arrivata da altri) · 'status' */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const getState = () => state;

// ---------- Utente corrente ----------

export function currentUser() {
  if (isCloud) return cloudUserId ? memberById(cloudUserId) || null : null;
  const id = safeGet(USER_KEY);
  return id ? state.team.find((x) => x.id === id) || null : null;
}
function setCurrentUser(id) {
  if (id) safeSet(USER_KEY, id);
  else safeDel(USER_KEY);
}
/** L'utente collegato ha questo permesso? (vedi ROLES in data.js) */
export const can = (perm) => !!ROLES[currentUser()?.role]?.perms.includes(perm);
/** Chi gestisce (titolare o ufficio) */
export const isAdmin = () => can('gestione');

// ---------- Letture ----------

export const byDate = (a, b) => (a.date || '9999').localeCompare(b.date || '9999');
export const condoById = (id) => state.condos.find((c) => c.id === id);
export const memberById = (id) => state.team.find((m) => m.id === id);
export const jobById = (id) => state.jobs.find((j) => j.id === id);
export const fieldTeam = () => state.team.filter((m) => m.field);
export const typeById = (id) => state.workTypes.find((t) => t.id === id) || { id, name: 'Lavoro', icon: 'tool', color: '#7A8794', months: [] };
export const workOf = (job) => condoById(job.condoId)?.works.find((w) => w.id === job.workId);
export const isDone = (job) => job.status === DONE;
/** Lavoro aggiunto a mano, fuori dal contratto: non conta nel "n° di N" */
export const isExtra = (job) => !job.workId;

/** Lavori visibili a un giardiniere: assegnati a lui o non ancora assegnati */
export const matchesMember = (job, memberId) => !memberId || !job.assignees?.length || job.assignees.includes(memberId);

function sortForDay(list) {
  return list.sort((a, b) => {
    const ca = condoById(a.condoId)?.name || '';
    const cb = condoById(b.condoId)?.name || '';
    return ca.localeCompare(cb) || typeById(a.typeId).name.localeCompare(typeById(b.typeId).name);
  });
}

export function jobsOn(iso, memberId) {
  return sortForDay(state.jobs.filter((j) => j.date === iso && matchesMember(j, memberId)));
}

export function jobsBetween(from, to, memberId) {
  return state.jobs.filter((j) => j.date && j.date >= from && j.date <= to && matchesMember(j, memberId)).sort(byDate);
}

export function overdueJobs(memberId) {
  const t = todayISO();
  return state.jobs.filter((j) => !isDone(j) && j.date && j.date < t && matchesMember(j, memberId)).sort(byDate);
}

export function unscheduledJobs() {
  return state.jobs.filter((j) => !isDone(j) && !j.date);
}

export function jobsOfCondo(condoId) {
  return state.jobs.filter((j) => j.condoId === condoId);
}

// ---------- Appuntamenti, promemoria, lavori extra ----------

export const eventById = (id) => (state.events || []).find((e) => e.id === id);

/** Chi può vedere la voce: Nicolas e Martina tutto; gli altri solo le proprie (o quelle per tutti) */
export function canSeeEvent(ev, user = currentUser()) {
  if (!user) return false;
  if (can('gestione')) return true;
  return !ev.assignees?.length || ev.assignees.includes(user.id);
}

/** Può spuntarla come fatta: chi la riceve oppure chi gestisce */
export const canToggleEvent = (ev, user = currentUser()) => !!user && (can('gestione') || !ev.assignees?.length || ev.assignees.includes(user.id));

const byTime = (a, b) => (a.date || '').localeCompare(b.date || '') || (a.time || '').localeCompare(b.time || '') || (a.title || '').localeCompare(b.title || '');

/** Voci di un giorno; memberId filtra per persona (null = tutte quelle visibili) */
export function eventsOn(iso, memberId) {
  return (state.events || []).filter((e) => e.date === iso && canSeeEvent(e) && matchesMember(e, memberId)).sort(byTime);
}

export function eventsBetween(from, to, memberId) {
  return (state.events || []).filter((e) => e.date >= from && e.date <= to && canSeeEvent(e) && matchesMember(e, memberId)).sort(byTime);
}

export function saveEvent(data) {
  if (!can('gestione')) return null;
  const fields = {
    kind: data.kind || 'appuntamento',
    title: String(data.title || '').trim(),
    date: data.date,
    time: data.time || '',
    endTime: data.time && data.endTime && data.endTime > data.time ? data.endTime : '',
    place: String(data.place || '').trim(),
    note: String(data.note || '').trim(),
    assignees: [...new Set(data.assignees || [])],
  };
  let ev = data.id ? eventById(data.id) : null;
  if (ev) {
    Object.assign(ev, fields);
  } else {
    ev = { id: uid('e_'), ...fields, done: false, createdBy: currentUser()?.id || null, createdAt: Date.now() };
    state.events.push(ev);
  }
  commit();
  return ev;
}

export function deleteEvent(id) {
  if (!can('gestione')) return;
  state.events = state.events.filter((e) => e.id !== id);
  commit();
}

export function toggleEventDone(id) {
  const ev = eventById(id);
  if (!ev || !canToggleEvent(ev)) return;
  ev.done = !ev.done;
  if (ev.done) { ev.doneAt = Date.now(); ev.doneBy = currentUser()?.id || null; } else { delete ev.doneAt; delete ev.doneBy; }
  commit();
}

/** Il database online ha già la tabella degli appuntamenti? (serve rieseguire schema.sql una volta) */
export const eventsAvailable = () => !isCloud || cloud.tableAvailable('events');

/** "n° 4 di 10": i fatti vengono prima, poi i programmati in ordine di data. null per i lavori extra */
export function jobNumber(job) {
  if (isExtra(job)) return null;
  const work = workOf(job);
  const list = state.jobs
    .filter((j) => j.workId === job.workId)
    .sort((a, b) => (isDone(a) === isDone(b) ? byDate(a, b) : isDone(a) ? -1 : 1));
  return { n: list.indexOf(job) + 1 + (work?.doneBefore || 0), of: work?.qty ?? list.length };
}

/** Cosa è stato registrato quando il lavoro è stato spuntato (durata, cosa è stato fatto, chi c'era) */
export function doneInfo(job) {
  if (!job || !isDone(job)) return null;
  const entry = [...(job.log || [])].reverse().find((l) => l.type === 'fatto');
  return {
    at: job.doneAt || entry?.at || null,
    by: job.doneBy || entry?.by || null,
    date: job.date,
    minutes: Number(entry?.minutes) || 0,
    note: entry?.note || '',
    team: entry?.team || [],
  };
}

/** Contratti che stanno per scadere (o già scaduti): serve a chi segue i pagamenti */
export function contractDeadlines(withinDays = 90) {
  const t = todayISO();
  return state.condos
    .filter((c) => c.contractEnd)
    .map((c) => ({ condo: c, days: diffDays(t, c.contractEnd), stats: condoStats(c) }))
    .filter((x) => x.days <= withinDays)
    .sort((a, b) => a.days - b.days);
}

export function workStats(condo, work) {
  const t = todayISO();
  const jobs = state.jobs.filter((j) => j.condoId === condo.id && j.workId === work.id);
  const done = jobs.filter(isDone).length + (work.doneBefore || 0);
  const pending = jobs.filter((j) => !isDone(j));
  return {
    total: work.qty,
    done,
    remaining: Math.max(0, work.qty - done),
    overdue: pending.filter((j) => j.date && j.date < t).length,
    unscheduled: pending.filter((j) => !j.date).length,
    next: pending.filter((j) => j.date && j.date >= t).sort(byDate)[0] || null,
  };
}

export function condoStats(condo) {
  const s = { total: 0, done: 0, remaining: 0, overdue: 0, unscheduled: 0, next: null };
  for (const w of condo.works) {
    const ws = workStats(condo, w);
    s.total += w.qty;
    s.done += Math.min(ws.done, w.qty);
    s.remaining += ws.remaining;
    s.overdue += ws.overdue;
    s.unscheduled += ws.unscheduled;
    if (ws.next && (!s.next || ws.next.date < s.next.date)) s.next = ws.next;
  }
  s.pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
  return s;
}

/** Ultime azioni della squadra (lavori fatti, rimandati, riaperti), dalla più recente */
export function recentActivity(limit = 20) {
  const out = [];
  for (const job of state.jobs) {
    for (const entry of job.log || []) {
      if (['fatto', 'rimandato', 'annullato'].includes(entry.type) && entry.at) out.push({ job, entry });
    }
  }
  return out.sort((a, b) => b.entry.at - a.entry.at).slice(0, limit);
}

/** Numeri di una persona: lavori assegnati oggi, in settimana, in ritardo */
export function memberStats(memberId, weekFrom, weekTo) {
  const t = todayISO();
  const mine = state.jobs.filter((j) => j.assignees?.includes(memberId));
  const today = mine.filter((j) => j.date === t);
  const week = mine.filter((j) => j.date && j.date >= weekFrom && j.date <= weekTo);
  return {
    today: today.length,
    todayDone: today.filter(isDone).length,
    week: week.length,
    weekDone: week.filter(isDone).length,
    overdue: mine.filter((j) => !isDone(j) && j.date && j.date < t).length,
  };
}

/** Riepilogo per tipo di lavoro in un periodo (es. la stagione in corso) */
export function summaryByType(from, to) {
  const map = new Map();
  for (const j of state.jobs) {
    if (!j.date || j.date < from || j.date > to) continue;
    const e = map.get(j.typeId) || { typeId: j.typeId, total: 0, done: 0 };
    e.total++;
    if (isDone(j)) e.done++;
    map.set(j.typeId, e);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

// ---------- Pagamenti dei clienti (solo titolare e amministrazione) ----------

export const paymentById = (id) => (state.payments || []).find((p) => p.id === id);
export const isPaid = (p) => !!p.paid;
/** Il database online ha già la tabella dei pagamenti? (serve rieseguire schema.sql una volta) */
export const paymentsAvailable = () => !isCloud || cloud.tableAvailable('payments');

/** Stato di una rata: pagata · scaduta · in scadenza (entro 15 giorni) · da pagare */
export function paymentStatus(p, t = todayISO()) {
  if (p.paid) return 'pagato';
  if (p.dueDate && p.dueDate < t) return 'scaduto';
  if (p.dueDate && p.dueDate <= addDays(t, 15)) return 'in-scadenza';
  return 'da-pagare';
}

const byDue = (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || (a.title || '').localeCompare(b.title || '');

export function paymentsOfCondo(condoId) {
  return (state.payments || []).filter((p) => p.condoId === condoId).sort(byDue);
}

/** Elenco filtrato: 'aperti' (da incassare) · 'scaduti' · 'pagati' · 'tutti' */
export function paymentsList(filter = 'aperti') {
  const t = todayISO();
  const list = (state.payments || []).filter((p) => {
    if (filter === 'aperti') return !p.paid;
    if (filter === 'scaduti') return paymentStatus(p, t) === 'scaduto';
    if (filter === 'pagati') return p.paid;
    return true;
  });
  return filter === 'pagati' ? list.sort((a, b) => (b.paidDate || '').localeCompare(a.paidDate || '')) : list.sort(byDue);
}

/** Totali per la contabilità */
export function paymentTotals(condoId = null) {
  const t = todayISO();
  const year = t.slice(0, 4);
  const list = (state.payments || []).filter((p) => !condoId || p.condoId === condoId);
  const sum = (arr) => arr.reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const open = list.filter((p) => !p.paid);
  const late = open.filter((p) => paymentStatus(p, t) === 'scaduto');
  const soon = open.filter((p) => paymentStatus(p, t) === 'in-scadenza');
  const paidYear = list.filter((p) => p.paid && (p.paidDate || '').startsWith(year));
  return {
    open: sum(open), openCount: open.length,
    late: sum(late), lateCount: late.length,
    soon: sum(soon), soonCount: soon.length,
    paidYear: sum(paidYear), paidYearCount: paidYear.length,
    total: sum(list), paid: sum(list.filter((p) => p.paid)),
  };
}

/** Condomini con pagamenti scaduti: i clienti da sollecitare, dal ritardo più vecchio */
export function clientsToCall() {
  const t = todayISO();
  const map = new Map();
  for (const p of state.payments || []) {
    if (paymentStatus(p, t) !== 'scaduto') continue;
    const e = map.get(p.condoId) || { condo: condoById(p.condoId), amount: 0, count: 0, oldest: p.dueDate };
    e.amount += Number(p.amount) || 0;
    e.count++;
    if (p.dueDate < e.oldest) e.oldest = p.dueDate;
    map.set(p.condoId, e);
  }
  return [...map.values()].filter((e) => e.condo).sort((a, b) => a.oldest.localeCompare(b.oldest));
}

/**
 * Nuova rata (o più rate uguali che si ripetono).
 * repeat = mesi tra una rata e l'altra (0 = una sola), count = quante rate
 */
export function addPayments({ condoId, title, amount, dueDate, repeat = 0, count = 1, note = '' }) {
  if (!can('pagamenti') || !condoById(condoId)) return [];
  const n = repeat ? Math.max(1, Math.min(36, Number(count) || 1)) : 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = {
      id: uid('p_'),
      condoId,
      title: String(title || '').trim() + (n > 1 ? ` (rata ${i + 1} di ${n})` : ''),
      amount: Math.round((Number(amount) || 0) * 100) / 100,
      dueDate: dueDate ? (repeat ? addMonths(dueDate, repeat * i) : dueDate) : null,
      paid: false,
      paidDate: null,
      method: '',
      note: String(note || '').trim(),
      createdBy: currentUser()?.id || null,
      createdAt: Date.now(),
    };
    state.payments.push(p);
    out.push(p);
  }
  commit();
  return out;
}

export function updatePayment(id, fields) {
  const p = paymentById(id);
  if (!p || !can('pagamenti')) return;
  const f = { ...fields };
  if ('amount' in f) f.amount = Math.round((Number(f.amount) || 0) * 100) / 100;
  if ('title' in f) f.title = String(f.title || '').trim();
  if ('note' in f) f.note = String(f.note || '').trim();
  Object.assign(p, f);
  commit();
}

/** Segna incassata (con data e modo) oppure di nuovo da incassare */
export function setPaid(id, paid, { date = todayISO(), method = '' } = {}) {
  const p = paymentById(id);
  if (!p || !can('pagamenti')) return;
  p.paid = !!paid;
  p.paidDate = paid ? date : null;
  p.method = paid ? method || p.method || '' : '';
  p.paidBy = paid ? currentUser()?.id || null : null;
  commit();
}

export function deletePayment(id) {
  if (!can('pagamenti')) return;
  state.payments = state.payments.filter((p) => p.id !== id);
  commit();
}

/** Controlli sui lavori: cosa non torna e va verificato */
export function workChecks() {
  const t = todayISO();
  const from = addDays(t, -30);
  const done = state.jobs.filter((j) => isDone(j) && j.date >= from && j.date <= t);
  return {
    late: overdueJobs(),
    unscheduled: unscheduledJobs(),
    // fatti negli ultimi 30 giorni senza scrivere quanto tempo o cosa è stato fatto
    noReport: done.filter((j) => { const i = doneInfo(j); return !i.minutes && !i.note; }).sort((a, b) => b.date.localeCompare(a.date)),
    doneMonth: done.length,
    minutesMonth: done.reduce((a, j) => a + (doneInfo(j).minutes || 0), 0),
    // condomini con contratto finito ma interventi ancora da fare
    endedOpen: state.condos.filter((c) => c.contractEnd && c.contractEnd < t && condoStats(c).remaining > 0),
  };
}

// ---------- Interventi ----------

function log(job, entry) {
  job.log ??= [];
  job.log.push({ at: Date.now(), by: currentUser()?.id, ...entry });
}

/**
 * Spunta un lavoro. I dettagli (giorno, durata, cosa è stato fatto) si possono
 * aggiungere subito oppure dopo con registerDone: il lavoro risulta fatto comunque.
 */
export function markDone(id, info = null) {
  const j = jobById(id);
  if (!j || isDone(j)) return;
  const t = todayISO();
  j.status = DONE;
  j.doneAt = Date.now();
  j.doneBy = currentUser()?.id;
  if (!j.date || j.date > t) { j.plannedDate = j.date; j.date = t; }
  log(j, { type: 'fatto' });
  commit();
  if (info) registerDone(id, info);
}

/** Aggiunge o corregge i dati del lavoro fatto: giorno, minuti impiegati, cosa è stato fatto, chi c'era */
export function registerDone(id, { date, minutes, note, team } = {}) {
  const j = jobById(id);
  if (!j || !isDone(j)) return;
  const entry = [...(j.log || [])].reverse().find((l) => l.type === 'fatto');
  if (date && date !== j.date) {
    if (entry) entry.movedFrom = j.date;
    j.date = date;
  }
  if (entry) {
    if (minutes !== undefined) entry.minutes = Math.max(0, Math.round(Number(minutes) || 0)) || undefined;
    if (note !== undefined) entry.note = String(note || '').trim() || undefined;
    if (team !== undefined) entry.team = team?.length ? [...new Set(team)] : undefined;
  }
  commit();
}

export function undoDone(id) {
  const j = jobById(id);
  if (!j || !isDone(j)) return;
  j.status = TODO;
  if ('plannedDate' in j) { j.date = j.plannedDate; delete j.plannedDate; }
  delete j.doneAt;
  delete j.doneBy;
  log(j, { type: 'annullato' });
  commit();
}

export function postpone(id, date, reason = '', note = '') {
  const j = jobById(id);
  if (!j) return;
  log(j, { type: 'rimandato', from: j.date, to: date, reason, note });
  j.date = date;
  fitAssignees(j);
  commit();
}

export function setJobDate(id, date) {
  const j = jobById(id);
  if (!j || j.date === date) return;
  log(j, { type: 'spostato', from: j.date, to: date });
  j.date = date;
  fitAssignees(j);
  commit();
}

export function setAssignees(id, ids) {
  const j = jobById(id);
  if (!j) return;
  j.assignees = [...ids];
  commit();
}

export function setJobNote(id, note) {
  const j = jobById(id);
  if (!j || j.note === note) return;
  j.note = note;
  commit();
}

export function deleteJob(id) {
  state.jobs = state.jobs.filter((j) => j.id !== id);
  commit();
}

/**
 * Intervento aggiunto a mano.
 * Con workId conta negli interventi previsti dal contratto;
 * con il solo typeId è un lavoro in più (extra), che non tocca i conteggi del contratto.
 */
export function addJob({ condoId, workId, typeId, date, note = '', assignees }) {
  const condo = condoById(condoId);
  if (!condo) return null;
  const work = workId ? condo.works.find((w) => w.id === workId) : null;
  if (workId && !work) return null;
  const type = work ? work.typeId : typeId;
  if (!type) return null;
  const j = newJob(condo, { id: work?.id || '', typeId: type }, date || null);
  if (note) j.note = note;
  if (assignees) j.assignees = [...new Set(assignees)];
  log(j, { type: 'aggiunto' });
  state.jobs.push(j);
  commit();
  return j;
}

function newJob(condo, work, date) {
  return {
    id: uid('j_'),
    condoId: condo.id,
    workId: work.id,
    typeId: work.typeId,
    date,
    status: TODO,
    assignees: defaultAssignees(condo, date),
    note: '',
    log: [{ type: 'creato', at: Date.now() }],
  };
}

// ---------- Condomini e pianificazione ----------

/** Quanti interventi ci sono già in ogni giorno (per non riempire troppo una giornata) */
function loadMap(exceptCondoId = null) {
  const m = {};
  for (const j of state.jobs) {
    if (!j.date || isDone(j) || (exceptCondoId && j.condoId === exceptCondoId)) continue;
    m[j.date] = (m[j.date] || 0) + 1;
  }
  return m;
}

/** Giorni in cui questo condominio ha già un intervento (per non metterne due lo stesso giorno) */
function busyDays(condoId, { onlyDone = false } = {}) {
  const s = new Set();
  for (const j of state.jobs) {
    if (j.condoId !== condoId || !j.date) continue;
    if (onlyDone && !isDone(j)) continue;
    s.add(j.date);
  }
  return s;
}

/** Cancella gli interventi non ancora fatti di un lavoro e ripianifica quelli che mancano */
function scheduleWork(condo, work, load, busyCondo) {
  state.jobs = state.jobs.filter((j) => !(j.workId === work.id && !isDone(j)));
  const done = state.jobs.filter((j) => j.workId === work.id && isDone(j)).length + (work.doneBefore || 0);
  const toPlan = Math.max(0, work.qty - done);
  const t = todayISO();
  const from = condo.contractStart > t ? condo.contractStart : t;
  const { dates } = planWork({
    plan: work.plan, from, to: condo.contractEnd, months: work.months, count: toPlan,
    workDays: state.settings.workDays, load, busyCondo,
  });
  for (let i = 0; i < toPlan; i++) state.jobs.push(newJob(condo, work, dates[i] || null));
}

/** Anteprima senza salvare: le date che verrebbero messe in calendario per ogni lavoro */
export function previewPlan(data, condoId = null) {
  const t = todayISO();
  const from = data.contractStart > t ? data.contractStart : t;
  const load = loadMap(condoId);
  const busyCondo = new Set();
  return data.works.map((w) => {
    const doneJobs = condoId ? state.jobs.filter((j) => j.workId === w.id && isDone(j)).length : 0;
    const toPlan = Math.max(0, w.qty - (w.doneBefore || 0) - doneJobs);
    const res = planWork({
      plan: w.plan, from, to: data.contractEnd, months: w.months, count: toPlan,
      workDays: state.settings.workDays, load, busyCondo,
    });
    return { work: w, toPlan, ...res };
  });
}

const CONDO_FIELDS = ['name', 'address', 'city', 'adminName', 'phone', 'email', 'notes', 'contractStart', 'contractEnd', 'team'];

function cleanWorks(works) {
  return works
    .filter((w) => w.qty > 0)
    .map((w) => ({
      id: w.id || uid('w_'), typeId: w.typeId, qty: Number(w.qty),
      months: [...w.months].sort((a, b) => a - b), doneBefore: Number(w.doneBefore) || 0,
      notes: w.notes || '', plan: normalizePlan(w.plan),
    }));
}

/** Due lavori dello stesso lavoro/condominio cambiano giorno? Allora va ripianificato */
const samePlan = (a, b) => JSON.stringify(normalizePlan(a)) === JSON.stringify(normalizePlan(b));

export function createCondo(data) {
  const condo = { id: uid('c_'), createdAt: Date.now() };
  for (const f of CONDO_FIELDS) condo[f] = data[f];
  condo.works = cleanWorks(data.works);
  state.condos.push(condo);
  const load = loadMap();
  const busyCondo = new Set();
  for (const w of condo.works) scheduleWork(condo, w, load, busyCondo);
  commit();
  return condo;
}

export function updateCondo(id, data) {
  const c = condoById(id);
  if (!c) return;
  const old = clone(c);
  for (const f of CONDO_FIELDS) c[f] = data[f];
  c.works = cleanWorks(data.works);

  const removed = old.works.filter((ow) => !c.works.some((w) => w.id === ow.id));
  state.jobs = state.jobs.filter((j) => !(j.condoId === id && !isDone(j) && removed.some((r) => r.id === j.workId)));

  const periodChanged = old.contractStart !== c.contractStart || old.contractEnd !== c.contractEnd;
  const load = loadMap(id);
  const busyCondo = busyDays(id);
  for (const w of c.works) {
    const ow = old.works.find((o) => o.id === w.id);
    const changed = !ow || periodChanged || ow.qty !== w.qty || ow.doneBefore !== w.doneBefore
      || ow.months.join() !== w.months.join() || !samePlan(ow.plan, w.plan);
    if (changed) {
      for (const j of state.jobs) if (j.workId === w.id && !isDone(j) && j.date) busyCondo.delete(j.date);
      scheduleWork(c, w, load, busyCondo);
    }
  }

  if (old.team.join() !== c.team.join()) {
    for (const j of state.jobs) {
      if (j.condoId === id && !isDone(j) && j.assignees.join() === defaultAssignees(old, j.date).join()) j.assignees = defaultAssignees(c, j.date);
    }
  }
  commit();
}

export function replanCondo(id) {
  const c = condoById(id);
  if (!c) return;
  const load = loadMap(id);
  const busyCondo = busyDays(id, { onlyDone: true });
  for (const w of c.works) scheduleWork(c, w, load, busyCondo);
  commit();
}

export function deleteCondo(id) {
  state.condos = state.condos.filter((c) => c.id !== id);
  state.jobs = state.jobs.filter((j) => j.condoId !== id);
  state.payments = (state.payments || []).filter((p) => p.condoId !== id);
  commit();
}

// ---------- Squadra, tipi di lavoro, impostazioni ----------

export function saveMember(member) {
  const { pass, email, ...fields } = member; // password ed email non si modificano da qui
  const existing = memberById(fields.id);
  if (existing) Object.assign(existing, fields);
  else if (!isCloud) state.team.push({ ...fields, id: uid('m_') });
  commit();
}

export async function removeMember(id) {
  if (isCloud) {
    await cloud.manageUsers({ action: 'delete', id });
    cloud.forget('profiles', id);
  }
  state.team = state.team.filter((m) => m.id !== id);
  for (const c of state.condos) c.team = c.team.filter((x) => x !== id);
  for (const j of state.jobs) j.assignees = j.assignees.filter((x) => x !== id);
  commit();
  if (isCloud) refreshLoginList();
}

export function saveWorkType(type) {
  const existing = state.workTypes.find((t) => t.id === type.id);
  if (existing) {
    Object.assign(existing, type);
  } else {
    const base = type.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'lavoro';
    let id = base;
    for (let i = 2; state.workTypes.some((t) => t.id === id); i++) id = `${base}-${i}`;
    type = { ...type, id };
    state.workTypes.push(type);
  }
  commit();
  return type;
}

export function setWorkDays(days) {
  state.settings.workDays = [...days].sort();
  commit();
}

// ---------- Backup ----------

export const exportData = () => JSON.stringify(state, null, 2);

export function importData(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data.condos) || !Array.isArray(data.jobs)) throw new Error('File non valido');
  if (!isCloud) {
    state = normalize(data);
    commit();
    return;
  }
  // Online: la squadra resta quella del database; le persone del backup vengono riconosciute per nome
  const byName = new Map(state.team.map((m) => [m.name.trim().toLowerCase(), m.id]));
  const idMap = new Map((data.team || []).map((m) => [m.id, byName.get(String(m.name || '').trim().toLowerCase())]));
  const mapId = (id) => (state.team.some((m) => m.id === id) ? id : idMap.get(id) || null);
  const mapIds = (ids = []) => [...new Set(ids.map(mapId).filter(Boolean))];

  for (const t of data.workTypes || []) if (!state.workTypes.some((x) => x.id === t.id)) state.workTypes.push(t);
  state.condos = data.condos.map((c) => ({ ...c, team: mapIds(c.team) }));
  const condoIds = new Set(state.condos.map((c) => c.id));
  state.jobs = data.jobs
    .filter((j) => condoIds.has(j.condoId))
    .map((j) => {
      const job = { ...j, assignees: mapIds(j.assignees), log: (j.log || []).map((l) => ({ ...l, by: l.by ? mapId(l.by) : l.by })) };
      if (j.doneBy) job.doneBy = mapId(j.doneBy) || undefined;
      return job;
    });
  if (Array.isArray(data.events) && cloud.tableAvailable('events')) {
    state.events = data.events.map((e) => ({ ...e, assignees: mapIds(e.assignees), doneBy: e.doneBy ? mapId(e.doneBy) : e.doneBy, createdBy: e.createdBy ? mapId(e.createdBy) : e.createdBy }));
  }
  if (Array.isArray(data.payments) && cloud.tableAvailable('payments') && can('pagamenti')) {
    state.payments = data.payments.filter((p) => condoIds.has(p.condoId)).map((p) => ({ ...p, createdBy: p.createdBy ? mapId(p.createdBy) : p.createdBy }));
  }
  commit();
}

export function clearAll() {
  state = { ...state, condos: [], jobs: [], payments: [] };
  if (!isCloud) state = normalize(state);
  commit();
}

// ---------- Prima versione di prova ----------

// Nomi dei condomini finti delle prime bozze: se sul dispositivo ci sono solo quelli, vengono tolti
const DEMO_NAMES = ['Condominio Le Querce', 'Residenza Il Parco', 'Condominio Aurora', 'Condominio Villa Verde', 'Residenza I Tigli'];
