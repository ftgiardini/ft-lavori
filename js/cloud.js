// Collegamento a Supabase: accesso, lettura dei dati, salvataggio e aggiornamenti in tempo reale.
//
// Come funziona il salvataggio: l'app lavora sempre sui dati in memoria (veloce, anche senza campo).
// Dopo ogni modifica confronta i dati con l'ultima versione salvata online e invia solo le righe cambiate.
// Se manca la connessione le modifiche restano in attesa e partono appena torna la rete.
// Le modifiche fatte dagli altri arrivano in tempo reale e aggiornano lo schermo.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const enabled = Boolean(SUPABASE_URL && SUPABASE_KEY);

let client = null;
export function getClient() {
  if (!enabled) return null;
  if (!client) {
    if (!window.supabase?.createClient) throw new Error('Libreria Supabase non caricata');
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'ftg-lavori-accesso' },
    });
  }
  return client;
}

// ---------- Tabelle: conversione tra dati dell'app e righe del database ----------

const orNull = (v) => (v === undefined || v === '' ? null : v);

export const TABLES = [
  {
    name: 'settings', key: 'settings', single: true, order: ['id'],
    toRow: (s) => ({ id: 1, work_days: s.workDays || [] }),
    fromRow: (r) => ({ workDays: r.work_days || [] }),
  },
  {
    name: 'work_types', key: 'workTypes', order: ['sort', 'id'],
    toRow: (t, i) => ({ id: t.id, name: t.name, icon: t.icon || 'tool', color: t.color || '#7A8794', months: t.months || [], sort: i }),
    fromRow: (r) => ({ id: r.id, name: r.name, icon: r.icon, color: r.color, months: r.months || [] }),
  },
  {
    // le persone si creano ed eliminano con la funzione "gestione-utenti"; qui solo modifiche
    name: 'profiles', key: 'team', updateOnly: true, order: ['sort', 'name', 'id'],
    toRow: (m) => ({ id: m.id, name: m.name, title: m.title || '', role: m.role, field: !!m.field, color: m.color || '#4F7CAC', days: m.days || [] }),
    fromRow: (r) => ({ id: r.id, name: r.name, title: r.title || '', role: r.role, field: r.field, color: r.color, days: r.days || [], email: r.email }),
  },
  {
    name: 'condos', key: 'condos', order: ['created_at', 'id'],
    toRow: (c) => ({
      id: c.id, name: c.name || '', address: c.address || '', city: c.city || '', admin_name: c.adminName || '',
      phone: c.phone || '', email: c.email || '', notes: c.notes || '',
      contract_start: orNull(c.contractStart), contract_end: orNull(c.contractEnd),
      team: c.team || [], works: c.works || [], created_at: c.createdAt ?? null,
    }),
    fromRow: (r) => ({
      id: r.id, name: r.name, address: r.address || '', city: r.city || '', adminName: r.admin_name || '',
      phone: r.phone || '', email: r.email || '', notes: r.notes || '',
      contractStart: r.contract_start, contractEnd: r.contract_end,
      team: r.team || [], works: r.works || [], createdAt: r.created_at,
    }),
  },
  {
    name: 'jobs', key: 'jobs', order: ['id'],
    toRow: (j) => ({
      id: j.id, condo_id: j.condoId, work_id: j.workId, type_id: j.typeId, date: orNull(j.date),
      status: j.status, assignees: j.assignees || [], note: j.note || '',
      done_at: j.doneAt ?? null, done_by: j.doneBy ?? null,
      date_moved: 'plannedDate' in j, planned_date: orNull(j.plannedDate),
      log: j.log || [],
    }),
    fromRow: (r) => {
      const j = {
        id: r.id, condoId: r.condo_id, workId: r.work_id, typeId: r.type_id, date: r.date,
        status: r.status, assignees: r.assignees || [], note: r.note || '', log: r.log || [],
      };
      if (r.done_at != null) j.doneAt = Number(r.done_at);
      if (r.done_by) j.doneBy = r.done_by;
      if (r.date_moved) j.plannedDate = r.planned_date;
      return j;
    },
  },
];
const tableByName = Object.fromEntries(TABLES.map((t) => [t.name, t]));

// JSON con chiavi ordinate: il database riordina i campi dei JSON, così il confronto resta affidabile
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined) o[k] = sortKeys(v[k]);
    return o;
  }
  return v;
}
const stable = (v) => JSON.stringify(sortKeys(v));

// ---------- Stato della sincronizzazione ----------

let hooks = {
  getState: () => null,
  canManage: () => false,
  onRemoteChange: () => {},
  onStatus: () => {},
  onRejected: () => {},
  onReconnect: () => {},
};
export function init(h) { hooks = { ...hooks, ...h }; }

// Ultima versione salvata online di ogni riga: tabella → Map(id → JSON)
let synced = emptySynced();
function emptySynced() { return Object.fromEntries(TABLES.map((t) => [t.name, new Map()])); }

export const snapshot = () => Object.fromEntries(Object.entries(synced).map(([k, m]) => [k, [...m]]));
export function restore(snap) {
  synced = emptySynced();
  for (const t of TABLES) for (const [id, s] of snap?.[t.name] || []) synced[t.name].set(id, s);
}
export function forget(table, id) { synced[table]?.delete(String(id)); }
export function reset() { synced = emptySynced(); }

let status = 'ok'; // ok · saving · offline · error
export const getStatus = () => status;
function setStatus(s) {
  if (s === status) return;
  status = s;
  hooks.onStatus(s);
}

const isNetworkError = (err) => !navigator.onLine || /fetch|network|load failed|timeout|timed out|connection/i.test(err?.message || String(err));

// ---------- Accesso ----------

export async function sessionUserId() {
  const { data } = await getClient().auth.getSession();
  return data.session?.user?.id || null;
}

export async function signIn(email, password) {
  const { data, error } = await getClient().auth.signInWithPassword({ email, password });
  if (error) {
    if (isNetworkError(error)) throw new Error('Nessuna connessione: per entrare serve internet.');
    return null;
  }
  return data.user.id;
}

export async function signOut() {
  channel?.unsubscribe();
  channel = null;
  try { await getClient().auth.signOut(); } catch { /* offline: la sessione locale viene comunque cancellata */ }
  reset();
}

export async function updatePassword(password) {
  const { error } = await getClient().auth.updateUser({ password });
  if (error) {
    if (/different from the old/i.test(error.message)) throw new Error('La nuova password deve essere diversa da quella attuale.');
    if (/at least|should be/i.test(error.message)) throw new Error('La password è troppo corta (almeno 6 caratteri).');
    throw new Error(isNetworkError(error) ? 'Nessuna connessione: riprova quando torna internet.' : error.message);
  }
}

/** Elenco persone per la schermata di accesso (visibile anche prima di entrare) */
export async function fetchLoginList() {
  const { data, error } = await getClient().rpc('elenco_accessi');
  if (error) throw error;
  return data.map(tableByName.profiles.fromRow);
}

/** Crea persone, imposta password, elimina accessi (solo titolare, tramite funzione sul server) */
export async function manageUsers(body) {
  const { data, error } = await getClient().functions.invoke('gestione-utenti', { body });
  if (error) {
    let msg = error.message || 'Errore';
    try {
      const j = await error.context?.json();
      if (j?.error) msg = j.error;
    } catch { /* risposta non JSON */ }
    if (/failed to send|failed to fetch|not found|404/i.test(msg)) {
      msg = navigator.onLine ? 'Funzione "gestione-utenti" non trovata su Supabase: va creata (vedi guida).' : 'Nessuna connessione: riprova quando torna internet.';
    }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// ---------- Lettura completa ----------

async function fetchTable(t) {
  const size = 1000;
  const out = [];
  for (let from = 0; ; from += size) {
    let q = getClient().from(t.name).select('*');
    for (const col of t.order) q = q.order(col, { ascending: true });
    const { data, error } = await q.range(from, from + size - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < size) break;
  }
  return out;
}

/** Scarica tutti i dati dal database e azzera le modifiche in sospeso */
export async function pullAll() {
  const results = await Promise.all(TABLES.map(fetchTable));
  const next = emptySynced();
  const data = {};
  TABLES.forEach((t, ti) => {
    const objs = results[ti].map(t.fromRow);
    objs.forEach((o, i) => next[t.name].set(String(o.id ?? 1), stable(t.toRow(o, i))));
    data[t.key] = t.single ? objs[0] || { workDays: [1, 2, 3, 4, 5, 6] } : objs;
  });
  synced = next;
  setStatus('ok');
  return data;
}

// ---------- Invio delle modifiche ----------

function diff(t, state) {
  const list = t.single ? [state[t.key]] : state[t.key] || [];
  const map = synced[t.name];
  const ids = new Set();
  const upserts = [];
  const updates = [];
  list.forEach((obj, i) => {
    const row = t.toRow(obj, i);
    const id = String(row.id);
    ids.add(id);
    const s = stable(row);
    if (map.get(id) === s) return;
    if (!map.has(id)) {
      // impostazioni mai scaricate: non si sovrascrivono quelle online con i valori predefiniti
      if (!t.updateOnly && !t.single) upserts.push({ row, s });
    } else {
      updates.push({ row, s });
    }
  });
  const deletes = t.updateOnly || t.single ? [] : [...map.keys()].filter((id) => !ids.has(id));
  return { t, upserts, updates, deletes };
}

/** Numero di righe modificate non ancora salvate online */
export function pendingCount() {
  const state = hooks.getState();
  if (!state) return 0;
  return TABLES.reduce((n, t) => { const d = diff(t, state); return n + d.upserts.length + d.updates.length + d.deletes.length; }, 0);
}

const chunks = (arr, size) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

function denied() {
  const e = new Error('Modifica non consentita per il tuo ruolo');
  e.denied = true;
  return e;
}

async function write({ t, upserts, updates }, manager) {
  const db = getClient();
  // chi gestisce invia tutto in blocco; per i giardinieri e per le persone si aggiorna riga per riga
  if (manager && !t.updateOnly) {
    for (const part of chunks([...upserts, ...updates], 400)) {
      const { error } = await db.from(t.name).upsert(part.map((x) => x.row));
      if (error) throw error;
      for (const x of part) synced[t.name].set(String(x.row.id), x.s);
    }
    return;
  }
  if (upserts.length) throw denied();
  for (const part of chunks(updates, 8)) {
    await Promise.all(part.map(async ({ row, s }) => {
      const { data, error } = await db.from(t.name).update(row).eq('id', row.id).select('id');
      if (error) throw error;
      if (!data?.length) throw denied();
      synced[t.name].set(String(row.id), s);
    }));
  }
}

async function remove({ t, deletes }) {
  for (const part of chunks(deletes, 200)) {
    const { error } = await getClient().from(t.name).delete().in('id', part);
    if (error) throw error;
    for (const id of part) synced[t.name].delete(id);
  }
}

async function pushOnce() {
  const state = hooks.getState();
  if (!state) return;
  const plan = TABLES.map((t) => diff(t, state));
  if (!plan.some((p) => p.upserts.length || p.updates.length || p.deletes.length)) return;
  setStatus('saving');
  const manager = hooks.canManage();
  for (const p of plan) if (p.upserts.length || p.updates.length) await write(p, manager); // prima i condomini, poi gli interventi
  for (const p of [...plan].reverse()) if (p.deletes.length) await remove(p); // prima gli interventi, poi i condomini
}

let pushing = null;
let again = false;
let timer = null;
let retryTimer = null;

/** Invia le modifiche in sospeso. Lancia un errore se non è stato possibile. */
export function push() {
  if (!enabled) return Promise.resolve();
  if (pushing) { again = true; return pushing; }
  pushing = (async () => {
    try {
      do { again = false; await pushOnce(); } while (again);
      clearTimeout(retryTimer);
      setStatus('ok');
    } catch (err) {
      if (!err.denied && isNetworkError(err)) {
        setStatus('offline');
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => push().catch(() => {}), 30000);
      } else {
        console.error('Salvataggio rifiutato', err);
        setStatus('error');
        hooks.onRejected(err);
      }
      throw err;
    } finally {
      pushing = null;
    }
  })();
  return pushing;
}

export function schedulePush(delay = 250) {
  clearTimeout(timer);
  timer = setTimeout(() => push().catch(() => {}), delay);
}

// ---------- Tempo reale ----------

let channel = null;

function applyChange(t, payload) {
  const state = hooks.getState();
  if (!state) return;
  const map = synced[t.name];

  if (payload.eventType === 'DELETE') {
    const id = String(payload.old?.id ?? '');
    if (!id || t.single) return;
    map.delete(id);
    const i = state[t.key].findIndex((x) => String(x.id) === id);
    if (i >= 0) { state[t.key].splice(i, 1); hooks.onRemoteChange(); }
    return;
  }

  const obj = t.fromRow(payload.new);
  if (t.single) {
    const localS = stable(t.toRow(state[t.key]));
    const remoteS = stable(t.toRow(obj));
    const pending = map.has('1') && map.get('1') !== localS;
    map.set('1', remoteS);
    if (!pending && localS !== remoteS) { state[t.key] = obj; hooks.onRemoteChange(); }
    return;
  }

  const id = String(obj.id);
  const arr = state[t.key];
  const i = arr.findIndex((x) => String(x.id) === id);
  const remoteS = stable(t.toRow(obj, i >= 0 ? i : arr.length));
  if (i >= 0) {
    const localS = stable(t.toRow(arr[i], i));
    if (localS === remoteS) { map.set(id, remoteS); return; } // è la nostra stessa modifica
    if (map.has(id) && map.get(id) !== localS) return; // abbiamo una modifica in sospeso: vince la nostra
    arr[i] = obj;
  } else {
    if (map.has(id)) return; // l'abbiamo appena eliminata noi
    arr.push(obj);
  }
  map.set(id, remoteS);
  hooks.onRemoteChange();
}

export function subscribeRealtime() {
  channel?.unsubscribe();
  let dropped = false;
  channel = getClient().channel('ftg-lavori');
  for (const t of TABLES) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: t.name }, (payload) => applyChange(t, payload));
  }
  channel.subscribe((st) => {
    if (st === 'SUBSCRIBED') {
      if (dropped) { dropped = false; hooks.onReconnect(); }
    } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(st)) {
      dropped = true;
    }
  });
}
