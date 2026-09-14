// Dettaglio intervento, "fatto", "rimanda" e aggiunta manuale di un intervento.
import * as store from '../store.js';
import { openSheet, toast, confirmDialog } from '../ui.js';
import { icon } from '../icons.js';
import { typeIcon, avatar, daysLabel } from '../components.js';
import { POSTPONE_REASONS } from '../data.js';
import { esc, fmtLong, fmtShort, fmtTime, addDays, todayISO, relDay, mapsUrl, parseISO } from '../utils.js';

export function toggleDone(id) {
  const job = store.jobById(id);
  if (!job) return;
  const type = store.typeById(job.typeId);
  if (store.isDone(job)) {
    store.undoDone(id);
    toast(`${type.name}: segnato di nuovo da fare`);
    return;
  }
  store.markDone(id);
  const condo = store.condoById(job.condoId);
  const work = store.workOf(job);
  const stats = condo && work ? store.workStats(condo, work) : null;
  let msg = `Fatto: ${type.name}`;
  if (stats) msg += stats.remaining === 0 ? ' · tutti quelli del contratto completati' : ` · ne mancano ${stats.remaining} su ${stats.total}`;
  toast(msg, { actionText: 'Annulla', onAction: () => store.undoDone(id) });
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
  fatto: () => 'Segnato come fatto',
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
    const { n, of } = store.jobNumber(job);
    const done = store.isDone(job);
    const admin = store.isAdmin();
    const late = !done && job.date && job.date < todayISO();
    const address = condo ? [condo.address, condo.city].filter(Boolean).join(', ') : '';
    const team = store.fieldTeam();

    s.setBody(`
      <div class="job-hero">
        ${typeIcon(type, 'lg')}
        <div class="grow">
          <h3>${esc(type.name)}</h3>
          <p>Intervento ${n} di ${of} previsti dal contratto</p>
        </div>
      </div>
      <div class="row wrap" style="margin-top:12px;gap:6px">
        ${done ? `<span class="chip chip-green">${icon('check')}Fatto${job.doneBy ? ` da ${esc(store.memberById(job.doneBy)?.name || '')}` : ''}</span>` : late ? `<span class="chip chip-red">${icon('alert')}In ritardo</span>` : `<span class="chip">${icon('clock')}Da fare</span>`}
      </div>

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
      : `<button class="btn btn-amber" data-act="postpone">${icon('redo')}Rimanda</button><button class="btn btn-primary" data-act="done">${icon('check')}Fatto</button>`);
  };

  s.el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const job = store.jobById(id);
    if (!job) return;
    switch (b.dataset.act) {
      case 'done': {
        const wasDone = store.isDone(job);
        toggleDone(id);
        if (!wasDone) s.close();
        break;
      }
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

  const worksOptions = () => (store.condoById(cId)?.works || [])
    .map((w) => `<option value="${w.id}">${esc(store.typeById(w.typeId).name)}</option>`).join('');

  const s = openSheet({
    title: 'Aggiungi intervento',
    subtitle: 'Un lavoro in più da mettere in calendario',
    body: `
      <div class="field"><label for="aj-condo">Condominio</label>
        <select id="aj-condo" class="select">${condos.map((c) => `<option value="${c.id}" ${c.id === cId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="aj-work">Lavoro</label><select id="aj-work" class="select">${worksOptions()}</select></div>
      <div class="field"><label for="aj-date">Data</label><input id="aj-date" class="input" type="date" value="${date}"></div>
      <p class="small muted" style="margin-top:12px">Conta come uno degli interventi previsti dal contratto per quel lavoro.</p>`,
    footer: `<button class="btn btn-ghost" data-close>Annulla</button><button class="btn btn-primary" data-ok>${icon('plus')}Aggiungi</button>`,
  });
  s.el.querySelector('#aj-condo').addEventListener('change', (e) => {
    cId = e.target.value;
    s.el.querySelector('#aj-work').innerHTML = worksOptions();
  });
  s.el.querySelector('[data-ok]').addEventListener('click', () => {
    const workId = s.el.querySelector('#aj-work').value;
    const d = s.el.querySelector('#aj-date').value;
    if (!workId) { toast('Questo condominio non ha lavori a contratto'); return; }
    store.addJob({ condoId: cId, workId, date: d });
    toast(`Intervento aggiunto${d ? ` per ${fmtLong(d)}` : ''}`);
    s.close();
  });
}
