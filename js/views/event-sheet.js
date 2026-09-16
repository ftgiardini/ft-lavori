// Appuntamenti, promemoria e lavori extra: scheda di dettaglio (tutti) e modulo di creazione/modifica (Nicolas e Martina).
import * as store from '../store.js';
import { icon } from '../icons.js';
import { openSheet, toast, confirmDialog } from '../ui.js';
import { avatar, eventTimeLabel } from '../components.js';
import { EVENT_KINDS, eventKind } from '../data.js';
import { esc, todayISO, fmtLong, fmtTime, fmtDuration, mapsUrl } from '../utils.js';
import { openAddJobSheet, openReportSheet } from './job-sheet.js';

const DB_UPDATE_MSG = 'Per usare gli appuntamenti va aggiornato il database: riesegui schema.sql su Supabase (vedi guida).';

/** Scelta rapida da "Aggiungi" nel calendario */
export function openAddChooser(date = todayISO()) {
  const s = openSheet({
    title: 'Aggiungi al calendario',
    subtitle: esc(fmtLong(date, true)),
    body: `
      <div class="options">
        ${EVENT_KINDS.map((k) => `
          <button class="option" data-kind="${k.id}">
            <span class="option-ic" style="background:color-mix(in srgb, ${k.color} 14%, white);color:${k.color}">${icon(k.icon)}</span>
            <span class="grow"><strong>${esc(k.label)}</strong><small>${k.id === 'appuntamento' ? 'Incontri, sopralluoghi, visite: con ora e luogo' : k.id === 'promemoria' ? 'Cose da ricordare, telefonate, consegne' : 'Un lavoro fuori dai contratti dei condomini'}</small></span>
            ${icon('right')}
          </button>`).join('')}
        <button class="option" data-job>
          <span class="option-ic">${icon('building')}</span>
          <span class="grow"><strong>Intervento in un condominio</strong><small>Un lavoro in più su un contratto (sfalcio, potatura…)</small></span>
          ${icon('right')}
        </button>
      </div>`,
  });
  s.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-kind], [data-job]');
    if (!b) return;
    s.close();
    setTimeout(() => {
      if ('job' in b.dataset) openAddJobSheet({ date });
      else openEventForm({ date, kind: b.dataset.kind });
    }, 230);
  });
}

/** Modulo nuovo / modifica */
export function openEventForm({ id = null, date = todayISO(), kind = 'appuntamento' } = {}) {
  if (!store.can('gestione')) return;
  if (!store.eventsAvailable()) { toast(DB_UPDATE_MSG, { duration: 8000 }); return; }
  const me = store.currentUser();
  const existing = id ? store.eventById(id) : null;
  const d = existing
    ? { ...existing, assignees: [...existing.assignees] }
    : { kind, title: '', date, time: '', endTime: '', place: '', note: '', assignees: [me.id] };
  const team = store.getState().team;
  let allDay = !d.time;

  const peoplePick = () => `
    <button class="${d.assignees.length === team.length ? 'on' : ''}" data-all>${icon('users')}Tutti</button>
    ${team.map((m) => `<button class="${d.assignees.includes(m.id) ? 'on' : ''}" data-person="${m.id}">${avatar(m, 'xs')}${esc(m.name)}${m.id === me.id ? ' <span class="small muted">(io)</span>' : ''}</button>`).join('')}`;

  const s = openSheet({
    title: existing ? 'Modifica' : `Nuovo ${eventKind(d.kind).label.toLowerCase()}`,
    body: `
      <div class="field">
        <span class="label">Tipo</span>
        <div class="pick" data-kinds>${EVENT_KINDS.map((k) => `<button class="${d.kind === k.id ? 'on' : ''}" data-kind="${k.id}">${icon(k.icon)}${esc(k.label)}</button>`).join('')}</div>
      </div>
      <div class="field">
        <label for="ev-title">Titolo *</label>
        <input id="ev-title" class="input" value="${esc(d.title)}" placeholder="${esc(eventKind(d.kind).placeholder)}" autocomplete="off" enterkeyhint="next">
      </div>
      <div class="field-row">
        <div class="field"><label for="ev-date">Giorno *</label><input id="ev-date" class="input" type="date" value="${esc(d.date)}"></div>
        <div class="field"><span class="label">Orario</span>
          <div class="seg ev-allday"><button class="${allDay ? 'on' : ''}" data-allday="1">Tutto il giorno</button><button class="${allDay ? '' : 'on'}" data-allday="0">Con ora</button></div>
        </div>
      </div>
      <div class="field-row" data-times ${allDay ? 'hidden' : ''}>
        <div class="field"><label for="ev-time">Dalle</label><input id="ev-time" class="input" type="time" value="${esc(d.time || '08:00')}"></div>
        <div class="field"><label for="ev-end">Alle (facoltativo)</label><input id="ev-end" class="input" type="time" value="${esc(d.endTime)}"></div>
      </div>
      <div class="field">
        <span class="label">Per chi</span>
        <div class="pick" data-people>${peoplePick()}</div>
        <p class="hint">Lo vedono nel loro calendario e in “Oggi”. Nicolas e Martina vedono sempre tutto.</p>
      </div>
      <div class="field">
        <label for="ev-place">Luogo o indirizzo (facoltativo)</label>
        <input id="ev-place" class="input" value="${esc(d.place)}" placeholder="Es. Via Roma 8, Minerbio" autocomplete="off">
      </div>
      <div class="field">
        <label for="ev-note">Note</label>
        <textarea id="ev-note" class="textarea" rows="4" placeholder="Spiega di cosa si tratta: chi incontrare, cosa portare, cosa ricordare…">${esc(d.note)}</textarea>
      </div>
      ${existing ? `<button class="link-btn" style="color:var(--red);margin-top:14px" data-delete>${icon('trash')}Elimina</button>` : ''}`,
    footer: `<button class="btn btn-ghost" data-close>Annulla</button><button class="btn btn-primary" data-save>${icon('check')}Salva</button>`,
  });
  const $ = (sel) => s.el.querySelector(sel);

  s.el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const ds = b.dataset;
    if (ds.kind) {
      d.kind = ds.kind;
      s.el.querySelectorAll('[data-kind]').forEach((x) => x.classList.toggle('on', x === b));
      $('#ev-title').placeholder = eventKind(d.kind).placeholder;
    }
    if (ds.allday !== undefined) {
      allDay = ds.allday === '1';
      b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      $('[data-times]').hidden = allDay;
    }
    if (ds.person) {
      d.assignees = d.assignees.includes(ds.person) ? d.assignees.filter((x) => x !== ds.person) : [...d.assignees, ds.person];
      $('[data-people]').innerHTML = peoplePick();
    }
    if ('all' in ds) {
      d.assignees = d.assignees.length === team.length ? [] : team.map((m) => m.id);
      $('[data-people]').innerHTML = peoplePick();
    }
    if ('delete' in ds && await confirmDialog({ title: 'Eliminare?', message: `“${esc(existing.title)}” verrà tolto dal calendario di tutti.`, confirmText: 'Elimina', danger: true })) {
      store.deleteEvent(existing.id);
      s.close();
      toast('Eliminato');
    }
    if ('save' in ds) {
      const data = {
        id: existing?.id,
        kind: d.kind,
        title: $('#ev-title').value,
        date: $('#ev-date').value,
        time: allDay ? '' : $('#ev-time').value,
        endTime: allDay ? '' : $('#ev-end').value,
        place: $('#ev-place').value,
        note: $('#ev-note').value,
        assignees: d.assignees,
      };
      if (!data.title.trim()) { toast('Scrivi il titolo'); $('#ev-title').focus(); return; }
      if (!data.date) { toast('Scegli il giorno'); return; }
      if (!allDay && !data.time) { toast('Scegli l’ora oppure “Tutto il giorno”'); return; }
      if (!data.assignees.length) { toast('Scegli per chi è (o “Tutti”)'); return; }
      store.saveEvent(data);
      s.close();
      const who = data.assignees.length === team.length ? 'tutta la squadra' : data.assignees.map((x) => store.memberById(x)?.name).filter(Boolean).join(', ');
      toast(`${existing ? 'Salvato' : 'Aggiunto'}: ${fmtLong(data.date)} · per ${who}`);
    }
  });
  if (!existing) setTimeout(() => $('#ev-title')?.focus(), 250);
}

/** Spunta un appuntamento / lavoro extra; per i lavori extra chiede tempo e cosa è stato fatto */
export function toggleEvent(id) {
  const ev = store.eventById(id);
  if (!ev || !store.canToggleEvent(ev)) return;
  const wasDone = ev.done;
  store.toggleEventDone(id);
  if (wasDone) { toast('Spunta tolta'); return; }
  if (ev.kind === 'lavoro') openEventReport(id);
  else toast('Segnato come fatto', { actionText: 'Annulla', onAction: () => store.toggleEventDone(id) });
}

export function openEventReport(id) {
  const ev = store.eventById(id);
  if (!ev) return;
  const me = store.currentUser();
  openReportSheet({
    subtitle: `${esc(ev.title || 'Lavoro extra')}${ev.place ? ` · ${esc(ev.place)}` : ''}`,
    message: 'Lavoro extra del calendario.',
    askDate: false,
    info: { minutes: ev.doneMinutes || 0, note: ev.doneNote || '', team: ev.doneTeam || [] },
    people: ev.assignees?.length ? ev.assignees.filter((x) => store.memberById(x)?.field) : me ? [me.id] : [],
    onSave: (data) => {
      store.registerEventDone(id, data);
      toast(`Registrato${data.minutes ? `: ${fmtDuration(data.minutes)}` : ''}`);
    },
    onSkip: () => toast('Fatto · puoi scrivere i dettagli anche dopo', { actionText: 'Annulla', onAction: () => store.toggleEventDone(id) }),
  });
}

/** Dettaglio (per tutti) */
export function openEventSheet(id) {
  const ev = store.eventById(id);
  if (!ev) return;
  const kind = eventKind(ev.kind);
  const admin = store.can('gestione');
  const people = ev.assignees.length ? ev.assignees.map((x) => store.memberById(x)).filter(Boolean) : [];
  const creator = store.memberById(ev.createdBy);
  const doneBy = store.memberById(ev.doneBy);
  const canToggle = store.canToggleEvent(ev);

  const s = openSheet({
    title: ev.title || kind.label,
    subtitle: `<span style="color:${kind.color};font-weight:700">${esc(kind.label)}</span>`,
    body: `
      <div class="card card-flush divided" style="box-shadow:none;border:1px solid var(--line)">
        <div class="info-row">${icon('calendar')}<div class="grow"><span class="label">Quando</span><span class="value">${esc(fmtLong(ev.date, true))} · ${esc(eventTimeLabel(ev))}</span></div></div>
        ${ev.place ? `<div class="info-row">${icon('pin')}<div class="grow"><span class="label">Dove</span><span class="value">${esc(ev.place)}</span></div><a class="btn btn-soft btn-sm" href="${mapsUrl(ev.place)}" target="_blank" rel="noopener">${icon('nav')}Naviga</a></div>` : ''}
        <div class="info-row">${icon('users')}<div class="grow"><span class="label">Per</span><span class="value row wrap" style="gap:6px">${people.length ? people.map((m) => `<span class="row" style="gap:5px">${avatar(m, 'xs')}${esc(m.name)}</span>`).join('') : 'Tutta la squadra'}</span></div></div>
        ${ev.done ? `<div class="info-row">${icon('check')}<div class="grow"><span class="label">Fatto</span><span class="value">${doneBy ? esc(doneBy.name) + ' · ' : ''}${ev.doneAt ? esc(fmtTime(ev.doneAt)) : ''}</span></div></div>` : ''}
        ${ev.done && ev.kind === 'lavoro' ? `
        <div class="info-row">${icon('note')}<div class="grow"><span class="label">Cosa è stato fatto</span>
          <span class="value" style="font-weight:500">${ev.doneNote ? esc(ev.doneNote) : '<span class="muted">Non registrato</span>'}</span>
          <span class="small muted" style="display:block;margin-top:3px">${ev.doneMinutes ? `Tempo: ${esc(fmtDuration(ev.doneMinutes))}` : 'Tempo non indicato'}${ev.doneTeam?.length ? ` · con ${ev.doneTeam.map((x) => esc(store.memberById(x)?.name || '')).join(', ')}` : ''}</span></div>
          ${canToggle ? `<button class="btn btn-soft btn-sm" data-report>${ev.doneNote || ev.doneMinutes ? 'Correggi' : 'Aggiungi'}</button>` : ''}
        </div>` : ''}
      </div>
      ${ev.note ? `<div class="field" style="margin-top:16px"><span class="label">Note</span><p class="event-note-full">${esc(ev.note)}</p></div>` : ''}
      ${creator ? `<p class="small muted" style="margin-top:14px">Inserito da ${esc(creator.name)}${ev.createdAt ? ` · ${esc(fmtTime(ev.createdAt))}` : ''}</p>` : ''}`,
    footer: `
      ${admin ? `<button class="btn btn-ghost" data-edit>${icon('edit')}Modifica</button>` : ''}
      ${canToggle ? (ev.done
        ? `<button class="btn btn-ghost" data-toggle>${icon('x')}Togli la spunta</button>`
        : `<button class="btn btn-primary" data-toggle>${icon('check')}${ev.kind === 'lavoro' ? 'Fatto · registra' : 'Fatto'}</button>`) : ''}
      ${!admin && !canToggle ? '<button class="btn btn-ghost" data-close>Chiudi</button>' : ''}`,
  });
  s.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-edit]')) { s.close(); setTimeout(() => openEventForm({ id }), 230); }
    if (e.target.closest('[data-toggle]')) {
      s.close();
      setTimeout(() => toggleEvent(id), 230);
    }
    if (e.target.closest('[data-report]')) {
      s.close();
      setTimeout(() => openEventReport(id), 230);
    }
  });
}
