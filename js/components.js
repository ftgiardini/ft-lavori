// Pezzi di interfaccia ripetuti in più schermate.
import { icon } from './icons.js';
import { esc, relDay, initials, seasonsFor, todayISO, WEEKDAYS, WEEKDAYS_SHORT } from './utils.js';
import * as store from './store.js';

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

/**
 * Scheda di un intervento con spunta "fatto".
 * @param {object} opts showDate: mostra la data · showCondo: mostra il condominio · actions: mostra "Rimanda"
 */
export function jobCard(job, { showDate = false, showCondo = true, actions = false } = {}) {
  const type = store.typeById(job.typeId);
  const condo = store.condoById(job.condoId);
  const { n, of } = store.jobNumber(job);
  const done = store.isDone(job);
  const late = !done && job.date && job.date < todayISO();
  const postponed = !done && job.log?.some((l) => l.type === 'rimandato');
  const doneBy = done ? store.memberById(job.doneBy) : null;

  const chips = [];
  if (showDate || late || !job.date) {
    chips.push(`<span class="chip ${late ? 'chip-red' : !job.date ? 'chip-amber' : ''}">${icon(late ? 'alert' : 'calendar')}${late ? 'In ritardo · ' : ''}${esc(relDay(job.date))}</span>`);
  }
  if (postponed) chips.push(`<span class="chip chip-amber">${icon('redo')}Rimandato</span>`);
  if (done) chips.push(`<span class="chip chip-green">${icon('check')}Fatto${doneBy ? ` da ${esc(doneBy.name)}` : ''}</span>`);
  if (job.note) chips.push(`<span class="chip">${icon('note')}Nota</span>`);

  return `
  <article class="job ${done ? 'is-done' : ''} ${late ? 'is-late' : ''}" style="--c:${type.color}">
    <div class="job-row">
      <button class="job-main" data-action="open-job" data-id="${job.id}">
        ${typeIcon(type)}
        <span class="job-text">
          <span class="job-title">${esc(type.name)} <span class="job-count">${n} di ${of}</span></span>
          ${showCondo ? `<span class="job-sub">${esc(condo?.name || 'Condominio eliminato')}</span>` : ''}
          ${chips.length || job.assignees?.length ? `<span class="job-meta">${chips.join('')}${avatars(job.assignees)}</span>` : ''}
        </span>
      </button>
      <button class="check ${done ? 'checked' : ''}" data-action="toggle-done" data-id="${job.id}" aria-label="${done ? 'Segna come da fare' : 'Segna come fatto'}">${icon('check')}</button>
    </div>
    ${actions && !done ? `<div class="job-actions"><button class="link-btn" data-action="postpone" data-id="${job.id}">${icon('redo')}Rimanda</button></div>` : ''}
  </article>`;
}
