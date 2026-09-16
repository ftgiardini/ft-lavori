// Pezzi di interfaccia ripetuti in più schermate.
import { icon } from './icons.js';
import { esc, relDay, initials, seasonsFor, todayISO, fmtDuration, WEEKDAYS, WEEKDAYS_SHORT } from './utils.js';
import * as store from './store.js';
import { eventKind } from './data.js';

export function avatar(member, size = 'sm') {
  if (!member) return '';
  return `<span class="avatar avatar-${size}" style="--c:${member.color}" title="${esc(member.name)}">${esc(initials(member.name))}</span>`;
}

/** "solo sabato", "solo Lun, Mer" oppure '' se lavora tutti i giorni */
export function daysLabel(member) {
  const days = member?.days;
  if (!days?.length) return '';
  if (days.length === 1) return `solo ${WEEKDAYS[days[0]].toLowerCase()}`;
  return `solo ${[...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WEEKDAYS_SHORT[d]).join(', ')}`;
}

/** Riga descrittiva della persona: ruolo + giorni */
export function memberSub(member) {
  return [member.title, daysLabel(member)].filter(Boolean).join(' · ');
}

export function avatars(ids = [], size = 'sm') {
  if (!ids.length) return '';
  return `<span class="avatars">${ids.map((id) => avatar(store.memberById(id), size)).join('')}</span>`;
}

export function typeIcon(type, size = 'md') {
  return `<span class="type-ic type-ic-${size}" style="--c:${type.color}">${icon(type.icon)}</span>`;
}

export function progressBar(done, total, tone = '') {
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return `<div class="progress ${tone ? `progress-${tone}` : ''}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>`;
}

export function seasonChips(months) {
  return seasonsFor(months).map((s) => `<span class="season" style="--c:${s.color}">${icon(s.icon)}${s.name}</span>`).join('');
}

export function sectionHead(title, extra = '') {
  return `<div class="section-head"><h2>${esc(title)}</h2>${extra}</div>`;
}

export function emptyState(iconName, title, text = '') {
  return `<div class="empty">${icon(iconName)}<h3>${esc(title)}</h3>${text ? `<p>${text}</p>` : ''}</div>`;
}

/** "09:30–11:00", "09:30" oppure "Tutto il giorno" */
export function eventTimeLabel(ev) {
  if (!ev.time) return 'Tutto il giorno';
  return ev.endTime ? `${ev.time}–${ev.endTime}` : ev.time;
}

/** Scheda di un appuntamento / promemoria / lavoro extra */
export function eventCard(ev, { showDate = false } = {}) {
  const kind = eventKind(ev.kind);
  const people = ev.assignees?.length ? avatars(ev.assignees) : '<span class="chip">Per tutti</span>';
  const canToggle = store.canToggleEvent(ev);
  return `
  <article class="job event ${ev.done ? 'is-done' : ''}" style="--c:${kind.color}">
    <div class="job-row">
      <button class="job-main" data-action="open-event" data-id="${ev.id}">
        <span class="type-ic type-ic-md" style="--c:${kind.color}">${icon(kind.icon)}</span>
        <span class="job-text">
          <span class="job-title">${esc(ev.title || kind.label)}</span>
          <span class="job-sub">${showDate ? `${esc(relDay(ev.date))} · ` : ''}${esc(eventTimeLabel(ev))}${ev.place ? ` · ${esc(ev.place)}` : ''}</span>
          ${ev.note ? `<span class="event-note">${esc(ev.note)}</span>` : ''}
          <span class="job-meta"><span class="chip" style="color:${kind.color}">${icon(kind.icon)}${esc(kind.label)}</span>${people}</span>
        </span>
      </button>
      ${canToggle ? `<button class="check ${ev.done ? 'checked' : ''}" data-action="toggle-event" data-id="${ev.id}" aria-label="${ev.done ? 'Segna come da fare' : 'Segna come fatto'}">${icon('check')}</button>` : ''}
    </div>
  </article>`;
}

/**
 * Scheda di un intervento con spunta "fatto".
 * @param {object} opts showDate: mostra la data · showCondo: mostra il condominio · actions: mostra "Rimanda"
 */
export function jobCard(job, { showDate = false, showCondo = true, actions = false } = {}) {
  const type = store.typeById(job.typeId);
  const condo = store.condoById(job.condoId);
  const num = store.jobNumber(job);
  const done = store.isDone(job);
  const late = !done && job.date && job.date < todayISO();
  const postponed = !done && job.log?.some((l) => l.type === 'rimandato');
  const doneBy = done ? store.memberById(job.doneBy) : null;
  const info = store.doneInfo(job);

  const chips = [];
  if (showDate || late || !job.date) {
    chips.push(`<span class="chip ${late ? 'chip-red' : !job.date ? 'chip-amber' : ''}">${icon(late ? 'alert' : 'calendar')}${late ? 'In ritardo · ' : ''}${esc(relDay(job.date))}</span>`);
  }
  if (postponed) chips.push(`<span class="chip chip-amber">${icon('redo')}Rimandato</span>`);
  if (done) chips.push(`<span class="chip chip-green">${icon('check')}Fatto${doneBy ? ` da ${esc(doneBy.name)}` : ''}</span>`);
  if (info?.minutes) chips.push(`<span class="chip">${icon('clock')}${esc(fmtDuration(info.minutes))}</span>`);
  if (job.note) chips.push(`<span class="chip">${icon('note')}Nota</span>`);

  return `
  <article class="job ${done ? 'is-done' : ''} ${late ? 'is-late' : ''}" style="--c:${type.color}">
    <div class="job-row">
      <button class="job-main" data-action="open-job" data-id="${job.id}">
        ${typeIcon(type)}
        <span class="job-text">
          <span class="job-title">${esc(type.name)} <span class="job-count">${num ? `${num.n} di ${num.of}` : 'in più'}</span></span>
          ${showCondo ? `<span class="job-sub">${esc(condo?.name || 'Condominio eliminato')}</span>` : ''}
          ${info?.note ? `<span class="event-note">${esc(info.note)}</span>` : ''}
          ${chips.length || job.assignees?.length ? `<span class="job-meta">${chips.join('')}${avatars(job.assignees)}</span>` : ''}
        </span>
      </button>
      <button class="check ${done ? 'checked' : ''}" data-action="toggle-done" data-id="${job.id}" aria-label="${done ? 'Segna come da fare' : 'Segna come fatto'}">${icon('check')}</button>
    </div>
    ${actions && !done ? `<div class="job-actions"><button class="btn btn-primary btn-sm" data-action="toggle-done" data-id="${job.id}">${icon('check')}Fatto · registra</button><button class="link-btn" data-action="postpone" data-id="${job.id}">${icon('redo')}Rimanda</button></div>` : ''}
    ${actions && done && !info?.minutes && !info?.note ? `<div class="job-actions"><button class="link-btn" data-action="register-done" data-id="${job.id}">${icon('note')}Scrivi cosa hai fatto e quanto tempo</button></div>` : ''}
  </article>`;
}
