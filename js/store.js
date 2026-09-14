// Archivio dati dell'app.
// Due modalità:
//  - ONLINE (Supabase configurato in config.js): dati condivisi tra tutti gli account, accesso con password,
//    aggiornamenti in tempo reale. Una copia resta sul dispositivo per funzionare anche senza campo.
//  - PROVA (config.js vuoto): dati salvati solo su questo dispositivo.
// Le schermate usano sempre le stesse funzioni, qualunque sia la modalità.
import { DEFAULT_WORK_TYPES, DEFAULT_TEAM, ROLES, WORK_TYPES_VERSION } from './data.js';
import { uid, todayISO, parseISO } from './utils.js';
import { planDates } from './scheduler.js';
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
  return { settings: { workDays: [1, 2, 3, 4, 5, 6] }, team: [], workTypes: [], condos: [], jobs: [] };
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

/** "n° 4 di 10": i fatti vengono prima, poi i programmati in ordine di data */
export function jobNumber(job) {
  const work = workOf(job);
  const list = state.jobs
    .filter((j) => j.workId === job.workId)
    .sort((a, b) => (isDone(a) === isDone(b) ? byDate(a, b) : isDone(a) ? -1 : 1));
  return { n: list.indexOf(job) + 1 + (work?.doneBefore || 0), of: work?.qty ?? list.length };
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

// ---------- Interventi ----------

function log(job, entry) {
  job.log ??= [];
  job.log.push({ at: Date.now(), by: currentUser()?.id, ...entry });
}

export function markDone(id) {
  const j = jobById(id);
  if (!j || isDone(j)) return;
  const t = todayISO();
  j.status = DONE;
  j.doneAt = Date.now();
  j.doneBy = currentUser()?.id;
  if (!j.date || j.date > t) { j.plannedDate = j.date; j.date = t; }
  log(j, { type: 'fatto' });
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

export function addJob({ condoId, workId, date }) {
  const condo = condoById(condoId);
  const work = condo?.works.find((w) => w.id === workId);
  if (!work) return null;
  const j = newJob(condo, work, date || null);
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

function loadMap() {
  const m = {};
  for (const j of state.jobs) if (j.date && !isDone(j)) m[j.date] = (m[j.date] || 0) + 1;
  return m;
}

/** Cancella gli interventi non ancora fatti di un lavoro e ripianifica quelli che mancano */
function scheduleWork(condo, work, load) {
  state.jobs = state.jobs.filter((j) => !(j.workId === work.id && !isDone(j)));
  const done = state.jobs.filter((j) => j.workId === work.id && isDone(j)).length + (work.doneBefore || 0);
  const toPlan = Math.max(0, work.qty - done);
  const t = todayISO();
  const from = condo.contractStart > t ? condo.contractStart : t;
  const dates = planDates({ from, to: condo.contractEnd, months: work.months, count: toPlan, workDays: state.settings.workDays, load });
  for (let i = 0; i < toPlan; i++) state.jobs.push(newJob(condo, work, dates[i] || null));
}

/** Anteprima senza salvare: quante date trova per ogni lavoro */
export function previewPlan(data) {
  const t = todayISO();
  const from = data.contractStart > t ? data.contractStart : t;
  const load = loadMap();
  return data.works.map((w) => {
    const toPlan = Math.max(0, w.qty - (w.doneBefore || 0) - (w.doneJobs || 0));
    const dates = planDates({ from, to: data.contractEnd, months: w.months, count: toPlan, workDays: state.settings.workDays, load });
    return { work: w, toPlan, dates };
  });
}

const CONDO_FIELDS = ['name', 'address', 'city', 'adminName', 'phone', 'email', 'notes', 'contractStart', 'contractEnd', 'team'];

function cleanWorks(works) {
  return works
    .filter((w) => w.qty > 0)
    .map((w) => ({ id: w.id || uid('w_'), typeId: w.typeId, qty: Number(w.qty), months: [...w.months].sort((a, b) => a - b), doneBefore: Number(w.doneBefore) || 0, notes: w.notes || '' }));
}

export function createCondo(data) {
  const condo = { id: uid('c_'), createdAt: Date.now() };
  for (const f of CONDO_FIELDS) condo[f] = data[f];
  condo.works = cleanWorks(data.works);
  state.condos.push(condo);
  const load = loadMap();
  for (const w of condo.works) scheduleWork(condo, w, load);
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
  const load = loadMap();
  for (const w of c.works) {
    const ow = old.works.find((o) => o.id === w.id);
    const changed = !ow || periodChanged || ow.qty !== w.qty || ow.doneBefore !== w.doneBefore || ow.months.join() !== w.months.join();
    if (changed) scheduleWork(c, w, load);
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
  const load = loadMap();
  for (const w of c.works) scheduleWork(c, w, load);
  commit();
}

export function deleteCondo(id) {
  state.condos = state.condos.filter((c) => c.id !== id);
  state.jobs = state.jobs.filter((j) => j.condoId !== id);
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
  commit();
}

export function clearAll() {
  state = { ...state, condos: [], jobs: [] };
  if (!isCloud) state = normalize(state);
  commit();
}

// ---------- Prima versione di prova ----------

// Nomi dei condomini finti delle prime bozze: se sul dispositivo ci sono solo quelli, vengono tolti
const DEMO_NAMES = ['Condominio Le Querce', 'Residenza Il Parco', 'Condominio Aurora', 'Condominio Villa Verde', 'Residenza I Tigli'];
