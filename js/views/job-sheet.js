// Dettaglio intervento, "fatto" (con registrazione del lavoro), "rimanda" e aggiunta manuale di un intervento.
import * as store from '../store.js';
import { openSheet, toast, confirmDialog } from '../ui.js';
import { icon } from '../icons.js';
import { typeIcon, avatar, daysLabel } from '../components.js';
import { POSTPONE_REASONS, DURATIONS } from '../data.js';
import { esc, fmtLong, fmtShort, fmtTime, fmtDuration, addDays, todayISO, relDay, mapsUrl, parseISO } from '../utils.js';

/**
 * Spunta o toglie la spunta.
 * Quando si spunta, il lavoro risulta subito fatto (anche se si chiude tutto)
 * e si apre il pannello per registrare giorno, durata e cosa è stato fatto.
 */
export function toggleDone(id, { ask = true } = {}) {
  const job = store.jobById(id);
  if (!job) return;
  const type = store.typeById(job.typeId);
  if (store.isDone(job)) {
    store.undoDone(id);
    toast(`${type.name}: segnato di nuovo da fare`);
    return;
  }
  store.markDone(id);
  if (ask) { openDoneSheet(id); return; }
  toast(`Fatto: ${type.name}`, { actionText: 'Annulla', onAction: () => store.undoDone(id) });
}

/** Quanti ne mancano di questo lavoro nel contratto */
function remainingMsg(job) {
  const condo = store.condoById(job.condoId);
  const work = store.workOf(job);
  if (!condo || !work) return '';
  const stats = store.workStats(condo, work);
  return stats.remaining === 0 ? 'Tutti quelli del contratto sono stati fatti.' : `Ne mancano ${stats.remaining} su ${stats.total}.`;
}

const toMin = (hhmm) => { const [h, m] = String(hhmm || '').split(':').map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null; };

/**
 * Pannello "Lavoro fatto" (uguale per interventi nei condomini e lavori extra):
 * giorno, dalle/alle o durata, chi ha lavorato, cosa è stato fatto.
 * @param {object} o
 * @param {string} o.subtitle   cosa e dove
 * @param {string} o.message    riga sotto "Segnato come fatto"
 * @param {object} o.info       dati già registrati { date, minutes, note, team }
 * @param {string[]} o.people   chi proporre come squadra
 * @param {boolean} o.askDate   chiedere il giorno
 * @param {Function} o.onSave   ({ date, minutes, note, team }) => void
 * @param {Function} o.onSkip   chiusura con "Solo fatto"
 */
export function openReportSheet({ subtitle = '', message = '', info = {}, people = [], askDate = true, onSave, onSkip }) {
  const team = store.fieldTeam();
  let date = info.date || todayISO();
  let minutes = info.minutes || 0;
  let who = info.team?.length ? [...info.team] : [...people];

  const peopleRow = () => team.map((m) => `<button class="${who.includes(m.id) ? 'on' : ''}" data-who="${m.id}">${avatar(m, 'xs')}${esc(m.name)}</button>`).join('');
  const durRow = () => DURATIONS.map((n) => `<button class="${minutes === n ? 'on' : ''}" data-min="${n}">${esc(fmtDuration(n))}</button>`).join('');

  const s = openSheet({
    title: 'Lavoro fatto',
    subtitle,
    body: `
      <div class="done-hero">${icon('check')}<div><strong>Segnato come fatto</strong><small>${esc(message)}</small></div></div>
      <p class="small muted" style="margin:12px 2px 0">Scrivi quanto tempo ci avete messo e cosa avete fatto: Nicolas e Martina lo vedono nel registro dei lavori.</p>
      ${askDate ? `
      <div class="field" style="margin-top:14px">
        <label for="dn-date">In che giorno l'avete fatto</label>
        <input id="dn-date" class="input" type="date" value="${esc(date)}" max="${todayISO()}">
      </div>` : ''}
      <div class="field">
        <span class="label">Quanto tempo ci avete messo</span>
        <div class="field-row" style="margin-top:6px">
          <div class="field" style="margin:0"><label for="dn-from" class="small">Dalle</label><input id="dn-from" class="input" type="time" data-time></div>
          <div class="field" style="margin:0"><label for="dn-to" class="small">Alle</label><input id="dn-to" class="input" type="time" data-time></div>
        </div>
        <p class="hint" style="margin:8px 2px 6px">Oppure tocca la durata:</p>
        <div class="pick" data-durations>${durRow()}</div>
        <div class="row" style="margin-top:8px;gap:8px">
          <input class="input" type="number" inputmode="numeric" min="0" max="900" step="5" placeholder="Minuti" value="${minutes || ''}" data-minutes style="max-width:130px">
          <span class="small muted" data-min-label>${minutes ? esc(fmtDuration(minutes)) : 'minuti in tutto'}</span>
        </div>
      </div>
      <div class="field">
        <span class="label">Chi ha lavorato</span>
        <div class="pick" data-people style="margin-top:6px">${peopleRow()}</div>
      </div>
      <div class="field">
        <label for="dn-note">Cosa avete fatto</label>
        <textarea id="dn-note" class="textarea" rows="3" placeholder="Es. sfalcio completo, siepe davanti all'ingresso, portato via il materiale">${esc(info.note || '')}</textarea>
      </div>`,
    footer: `<button class="btn btn-ghost" data-skip>Dopo</button><button class="btn btn-primary" data-ok>${icon('check')}Registra</button>`,
  });
  const $ = (q) => s.el.querySelector(q);
  const setMinutes = (n) => {
    minutes = Math.max(0, Math.round(Number(n) || 0));
    $('[data-durations]').innerHTML = durRow();
    $('[data-minutes]').value = minutes || '';
    $('[data-min-label]').textContent = minutes ? fmtDuration(minutes) : 'minuti in tutto';
  };

  s.el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const ds = b.dataset;
    if (ds.min) setMinutes(minutes === Number(ds.min) ? 0 : Number(ds.min));
    if (ds.who) {
      who = who.includes(ds.who) ? who.filter((x) => x !== ds.who) : [...who, ds.who];
      $('[data-people]').innerHTML = peopleRow();
    }
    if ('skip' in ds) { s.close(); onSkip?.(); }
    if ('ok' in ds) {
      const note = $('#dn-note').value.trim();
      if (!minutes && !note) { toast('Scrivi almeno quanto tempo ci avete messo o cosa avete fatto'); return; }
      onSave({ date: askDate ? $('#dn-date').value || date : undefined, minutes, note, team: who });
      s.close();
    }
  });
  s.el.addEventListener('input', (e) => {
    if (e.target.matches('[data-minutes]')) {
      minutes = Math.max(0, Number(e.target.value) || 0);
      $('[data-durations]').innerHTML = durRow();
      $('[data-min-label]').textContent = minutes ? fmtDuration(minutes) : 'minuti in tutto';
    }
    if (e.target.matches('[data-time]')) {
      const a = toMin($('#dn-from').value);
      const b = toMin($('#dn-to').value);
      if (a !== null && b !== null && b > a) setMinutes(b - a);
    }
  });
}

/** Registrazione di un intervento nel condominio */
export function openDoneSheet(id) {
  const job = store.jobById(id);
  if (!job) return;
  const type = store.typeById(job.typeId);
  const condo = store.condoById(job.condoId);
  const info = store.doneInfo(job) || {};
  const me = store.currentUser();
  openReportSheet({
    subtitle: `${esc(type.name)}${condo ? ` · ${esc(condo.name)}` : ''}`,
    message: remainingMsg(job) || 'Lavoro in più, fuori contratto.',
    info: { ...info, date: info.date || job.date },
    people: job.assignees?.length ? job.assignees : me ? [me.id] : [],
    onSave: (data) => {
      store.registerDone(id, data);
      toast(`Registrato: ${type.name}${data.minutes ? ` · ${fmtDuration(data.minutes)}` : ''}`);
    },
    onSkip: () => toast(`Fatto: ${type.name} · puoi scrivere i dettagli anche dopo`, { actionText: 'Annulla', onAction: () => store.undoDone(id) }),
  });
}

// ---------- Rimanda ----------

export function openPostponeSheet(id) {
  const job = store.jobById(id);
  if (!job) return;
  const type = store.typeById(job.typeId);
  const condo = store.condoById(job.condoId);
  const t = todayISO();
  const wd = parseISO(t).getDay();
  const nextMonday = addDays(t, wd === 1 ? 7 : (8 - wd) % 7 || 7);
  const quick = [['Domani', addDays(t, 1)], ['Dopodomani', addDays(t, 2)], ['Lunedì prossimo', nextMonday], ['Tra una settimana', addDays(t, 7)]]
    .filter(([, d], i, all) => all.findIndex(([, x]) => x === d) === i);
  let date = quick[0][1];
  let reason = '';

  const s = openSheet({
    title: 'Rimanda lavoro',
    subtitle: `${esc(type.name)} · ${esc(condo?.name || '')}`,
    body: `
      <div class="field">
        <span class="label">A quando lo spostiamo?</span>
        <div class="pick" data-dates>
          ${quick.map(([label, d], i) => `<button class="${i === 0 ? 'on' : ''}" data-date="${d}">${label} <span class="muted small">${fmtShort(d)}</span></button>`).join('')}
        </div>
        <input class="input" type="date" data-custom value="${date}" min="${t}" aria-label="Scegli una data">
      </div>
      <div class="field">
        <span class="label">Motivo</span>
        <div class="pick" data-reasons>${POSTPONE_REASONS.map((r) => `<button data-reason="${esc(r)}">${esc(r)}</button>`).join('')}</div>
      </div>
      <div class="field">
        <label for="pp-note">Nota <span class="muted">(facoltativa)</span></label>
        <textarea id="pp-note" class="textarea" rows="2" placeholder="Es. terreno troppo bagnato"></textarea>
      </div>`,
    footer: `<button class="btn btn-ghost" data-close>Annulla</button><button class="btn btn-primary" data-ok>${icon('redo')}<span data-ok-label>Rimanda a ${fmtShort(date)}</span></button>`,
  });

  const setDate = (d) => {
    date = d;
    s.el.querySelectorAll('[data-date]').forEach((b) => b.classList.toggle('on', b.dataset.date === d));
    s.el.querySelector('[data-custom]').value = d;
    s.el.querySelector('[data-ok-label]').textContent = `Rimanda a ${fmtShort(d)}`;
    s.el.querySelector('[data-ok]').disabled = !d;
  };

  s.el.addEventListener('click', (e) => {
    const dBtn = e.target.closest('[data-date]');
    if (dBtn) setDate(dBtn.dataset.date);
    const rBtn = e.target.closest('[data-reason]');
    if (rBtn) {
      reason = reason === rBtn.dataset.reason ? '' : rBtn.dataset.reason;
      s.el.querySelectorAll('[data-reason]').forEach((b) => b.classList.toggle('on', b.dataset.reason === reason));
    }
    if (e.target.closest('[data-ok]') && date) {
      store.postpone(id, date, reason, s.el.querySelector('#pp-note').value.trim());
      toast(`Rimandato a ${fmtLong(date)}`);
      s.close();
    }
  });
  s.el.querySelector('[data-custom]').addEventListener('change', (e) => setDate(e.target.value));
}

// ---------- Dettaglio ----------

const LOG_TEXT = {
  creato: () => 'Pianificato',
  aggiunto: () => 'Aggiunto a mano',
  spostato: (l) => `Spostato ${l.from ? `da ${fmtShort(l.from)} ` : ''}a ${l.to ? fmtShort(l.to) : 'da programmare'}`,
  rimandato: (l) => `Rimandato ${l.from ? `da ${fmtShort(l.from)} ` : ''}a ${fmtShort(l.to)}${l.reason ? ` · ${esc(l.reason)}` : ''}${l.note ? ` · “${esc(l.note)}”` : ''}`,
  fatto: (l) => `Fatto${l.minutes ? ` in ${fmtDuration(l.minutes)}` : ''}${l.movedFrom ? ` (spostato dal ${fmtShort(l.movedFrom)})` : ''}${l.note ? ` · “${esc(l.note)}”` : ''}`,
  annullato: () => 'Riaperto (tolta la spunta)',
};

export function openJobSheet(id) {
  let unsub = null;
  const s = openSheet({ title: 'Intervento', onClose: () => unsub?.() });

  const draw = () => {
    const job = store.jobById(id);
    if (!job) { s.close(); return; }
    const type = store.typeById(job.typeId);
    const condo = store.condoById(job.condoId);
    const num = store.jobNumber(job);
    const done = store.isDone(job);
    const admin = store.isAdmin();
    const late = !done && job.date && job.date < todayISO();
    const address = condo ? [condo.address, condo.city].filter(Boolean).join(', ') : '';
    const team = store.fieldTeam();
    const info = store.doneInfo(job);
    const whoDid = (info?.team || []).map((x) => store.memberById(x)).filter(Boolean);

    s.setBody(`
      <div class="job-hero">
        ${typeIcon(type, 'lg')}
        <div class="grow">
          <h3>${esc(type.name)}</h3>
          <p>${num ? `Intervento ${num.n} di ${num.of} previsti dal contratto` : 'Lavoro in più, fuori dal contratto'}</p>
        </div>
      </div>
      <div class="row wrap" style="margin-top:12px;gap:6px">
        ${done ? `<span class="chip chip-green">${icon('check')}Fatto${job.doneBy ? ` da ${esc(store.memberById(job.doneBy)?.name || '')}` : ''}</span>` : late ? `<span class="chip chip-red">${icon('alert')}In ritardo</span>` : `<span class="chip">${icon('clock')}Da fare</span>`}
        ${info?.minutes ? `<span class="chip">${icon('clock')}${esc(fmtDuration(info.minutes))}</span>` : ''}
      </div>

      ${done ? `
      <div class="card card-flush divided" style="margin-top:14px">
        <div class="info-row">
          ${icon('note')}
          <div class="grow"><span class="label">Cosa è stato fatto</span><span class="value" style="font-weight:500">${info?.note ? esc(info.note) : '<span class="muted">Non registrato</span>'}</span>
          ${whoDid.length ? `<span class="small muted" style="display:block;margin-top:4px">Con: ${whoDid.map((m) => esc(m.name)).join(', ')}</span>` : ''}</div>
          <button class="btn btn-soft btn-sm" data-act="register">${info?.note || info?.minutes ? 'Correggi' : 'Aggiungi'}</button>
        </div>
      </div>` : ''}

      <div class="card card-flush divided" style="margin-top:14px">
        <div class="info-row">
          ${icon('calendar')}
          <div class="grow"><span class="label">Data</span><span class="value">${job.date ? `${fmtLong(job.date, true)} <span class="muted">· ${relDay(job.date)}</span>` : 'Da programmare'}</span></div>
          ${admin && !done ? `<button class="btn btn-soft btn-sm" data-act="show-date">Cambia</button>` : ''}
        </div>
        <div class="info-row" data-date-row hidden>
          <input class="input" type="date" data-newdate value="${job.date || ''}" aria-label="Nuova data">
        </div>
        <div class="info-row">
          ${icon('building')}
          <div class="grow"><span class="label">Condominio</span><button class="value" data-act="goto-condo" style="text-align:left">${esc(condo?.name || '—')}</button>${address ? `<span class="small muted" style="display:block">${esc(address)}</span>` : ''}</div>
          ${address ? `<a class="btn btn-soft btn-sm" href="${mapsUrl(address)}" target="_blank" rel="noopener">${icon('nav')}Naviga</a>` : ''}
        </div>
        <div class="info-row">
          ${icon('users')}
          <div class="grow"><span class="label">Chi lo fa</span>
            <span class="value">${job.assignees.length ? job.assignees.map((mid) => esc(store.memberById(mid)?.name || '')).join(', ') : 'Non assegnato'}</span>
          </div>
        </div>
      </div>

      ${admin ? `
      <div class="field" style="margin-top:16px">
        <span class="label">Assegna a</span>
        <div class="pick">
        ${(() => {
          const avail = team.filter((m) => store.isAvailable(m, job.date)).map((m) => m.id);
          const allOn = avail.length > 0 && avail.every((mid) => job.assignees.includes(mid));
          return team.length ? `<button class="${allOn ? 'on' : ''}" data-act="assign-all" title="Tutti quelli che lavorano quel giorno">${icon('users')}Tutti</button>` : '';
        })()}
        ${team.map((m) => {
          const off = !store.isAvailable(m, job.date);
          return `<button class="${job.assignees.includes(m.id) ? 'on' : ''}" data-act="assign" data-member="${m.id}" ${off ? 'style="opacity:.6"' : ''}>${avatar(m, 'xs')}${esc(m.name)}${off ? ` <span class="small muted">(${daysLabel(m)})</span>` : ''}</button>`;
        }).join('')}</div>
      </div>` : ''}

      <div class="field" style="margin-top:16px">
        <label for="job-note">Note per la squadra</label>
        <textarea id="job-note" class="textarea" rows="2" data-note placeholder="Es. chiavi dal portinaio, attenzione al cancello…">${esc(job.note || '')}</textarea>
      </div>

      <div class="section" style="margin-top:18px">
        <div class="section-head"><h2>Storico</h2></div>
        <ul class="timeline">
          ${[...(job.log || [])].reverse().map((l) => `<li class="t-${l.type}"><div><span class="strong">${(LOG_TEXT[l.type] || (() => l.type))(l)}</span><br><span class="muted small">${fmtTime(l.at)}${l.by && store.memberById(l.by) ? ` · ${esc(store.memberById(l.by).name)}` : ''}</span></div></li>`).join('')}
        </ul>
      </div>
      ${admin ? `<button class="link-btn" style="color:var(--red);margin-top:10px" data-act="delete">${icon('trash')}Elimina questo intervento</button>` : ''}
    `);

    s.setFooter(done
      ? `<button class="btn btn-ghost" data-act="done">${icon('x')}Togli la spunta</button>`
      : `<button class="btn btn-amber" data-act="postpone">${icon('redo')}Rimanda</button><button class="btn btn-primary" data-act="done">${icon('check')}Fatto · registra</button>`);
  };

  s.el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const job = store.jobById(id);
    if (!job) return;
    switch (b.dataset.act) {
      case 'done': {
        const wasDone = store.isDone(job);
        if (wasDone) { toggleDone(id); break; }
        store.markDone(id);
        s.close();
        setTimeout(() => openDoneSheet(id), 230);
        break;
      }
      case 'register': s.close(); setTimeout(() => openDoneSheet(id), 230); break;
      case 'postpone': openPostponeSheet(id); break;
      case 'show-date': s.el.querySelector('[data-date-row]').hidden = false; break;
      case 'assign-all': {
        const avail = store.fieldTeam().filter((m) => store.isAvailable(m, job.date)).map((m) => m.id);
        const allOn = avail.length > 0 && avail.every((mid) => job.assignees.includes(mid));
        store.setAssignees(id, allOn ? [] : avail);
        break;
      }
      case 'assign': {
        const m = b.dataset.member;
        const ids = job.assignees.includes(m) ? job.assignees.filter((x) => x !== m) : [...job.assignees, m];
        store.setAssignees(id, ids);
        break;
      }
      case 'goto-condo': s.close(); location.hash = `#/condomini/${job.condoId}`; break;
      case 'delete':
        if (await confirmDialog({ title: 'Eliminare l’intervento?', message: 'Verrà tolto dal calendario e dal conteggio del contratto.', confirmText: 'Elimina', danger: true })) {
          store.deleteJob(id);
          toast('Intervento eliminato');
        }
        break;
    }
  });
  s.el.addEventListener('change', (e) => {
    if (e.target.matches('[data-note]')) store.setJobNote(id, e.target.value.trim());
    if (e.target.matches('[data-newdate]') && e.target.value) {
      store.setJobDate(id, e.target.value);
      toast(`Spostato a ${fmtLong(e.target.value)}`);
    }
  });

  draw();
  // se arriva una modifica dagli altri mentre si scrive la nota, si aggiorna dopo
  unsub = store.subscribe((source) => {
    if (source === 'status') return;
    if (source === 'remote' && s.el.contains(document.activeElement) && document.activeElement.matches('textarea, input')) return;
    draw();
  });
}

// ---------- Aggiungi intervento a mano ----------

export function openAddJobSheet({ date = todayISO(), condoId = '' } = {}) {
  const condos = [...store.getState().condos].sort((a, b) => a.name.localeCompare(b.name));
  if (!condos.length) { toast('Aggiungi prima un condominio'); return; }
  let cId = condoId || condos[0].id;

  // Si può scegliere un lavoro del contratto oppure qualsiasi altro tipo di lavoro (anche nuovo)
  const worksOptions = () => {
    const condo = store.condoById(cId);
    const contract = condo?.works || [];
    const used = new Set(contract.map((w) => w.typeId));
    const others = store.getState().workTypes.filter((t) => !used.has(t.id));
    return `
      ${contract.length ? `<optgroup label="Previsti dal contratto">${contract.map((w) => `<option value="w:${w.id}">${esc(store.typeById(w.typeId).name)}</option>`).join('')}</optgroup>` : ''}
      <optgroup label="Altri lavori (in più, fuori contratto)">
        ${others.map((t) => `<option value="t:${t.id}">${esc(t.name)}</option>`).join('')}
        ${contract.map((w) => `<option value="t:${w.typeId}">${esc(store.typeById(w.typeId).name)} (in più)</option>`).join('')}
      </optgroup>
      <optgroup label="Altro"><option value="nuovo">+ Scrivi un lavoro nuovo…</option></optgroup>`;
  };

  const s = openSheet({
    title: 'Aggiungi intervento',
    subtitle: 'Un lavoro in più da mettere in calendario',
    body: `
      <div class="field"><label for="aj-condo">Condominio</label>
        <select id="aj-condo" class="select">${condos.map((c) => `<option value="${c.id}" ${c.id === cId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="aj-work">Lavoro</label><select id="aj-work" class="select">${worksOptions()}</select></div>
      <div class="field" data-new-wrap hidden><label for="aj-new">Nome del lavoro nuovo</label>
        <input id="aj-new" class="input" placeholder="Es. Pulizia tombini, potatura alberi…" autocomplete="off">
        <p class="hint">Viene aggiunto all'elenco dei tipi di lavoro, così la prossima volta lo trovi già pronto.</p></div>
      <div class="field"><label for="aj-date">Data</label><input id="aj-date" class="input" type="date" value="${date}"></div>
      <div class="field"><label for="aj-note">Nota <span class="muted">(facoltativa)</span></label>
        <textarea id="aj-note" class="textarea" rows="2" placeholder="Es. richiesta dall'amministratore"></textarea></div>
      <p class="small muted">I lavori <b class="strong">previsti dal contratto</b> contano nel conteggio (es. 4 di 10). Quelli <b class="strong">in più</b> restano fuori dal contratto.</p>`,
    footer: `<button class="btn btn-ghost" data-close>Annulla</button><button class="btn btn-primary" data-ok>${icon('plus')}Aggiungi</button>`,
  });

  const workSel = s.el.querySelector('#aj-work');
  const newWrap = s.el.querySelector('[data-new-wrap]');
  const syncNew = () => { newWrap.hidden = workSel.value !== 'nuovo'; if (!newWrap.hidden) s.el.querySelector('#aj-new').focus(); };
  workSel.addEventListener('change', syncNew);
  s.el.querySelector('#aj-condo').addEventListener('change', (e) => {
    cId = e.target.value;
    workSel.innerHTML = worksOptions();
    syncNew();
  });

  s.el.querySelector('[data-ok]').addEventListener('click', () => {
    const val = workSel.value;
    const d = s.el.querySelector('#aj-date').value;
    const note = s.el.querySelector('#aj-note').value.trim();
    if (!val) { toast('Scegli il lavoro'); return; }
    let payload = { condoId: cId, date: d, note };
    if (val === 'nuovo') {
      const name = s.el.querySelector('#aj-new').value.trim();
      if (!name) { toast('Scrivi il nome del lavoro'); return; }
      const type = store.saveWorkType({ name, icon: 'tool', color: '#7B61C9', months: [] });
      payload.typeId = type.id;
    } else if (val.startsWith('w:')) {
      payload.workId = val.slice(2);
    } else {
      payload.typeId = val.slice(2);
    }
    if (!store.addJob(payload)) { toast('Non sono riuscito ad aggiungere il lavoro'); return; }
    toast(`Intervento aggiunto${d ? ` per ${fmtLong(d)}` : ''}`);
    s.close();
  });
}
