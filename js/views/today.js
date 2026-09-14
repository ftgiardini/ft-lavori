// "Oggi": i lavori del giorno raggruppati per condominio (dove andare e cosa fare).
import * as store from '../store.js';
import { icon } from '../icons.js';
import { rerender } from '../ui.js';
import { jobCard, eventCard, emptyState, sectionHead, daysLabel } from '../components.js';
import { openEventForm } from './event-sheet.js';
import { esc, todayISO, addDays, fmtLong, diffDays, mapsUrl, plural } from '../utils.js';

let day = null;
let mode = null; // 'mine' | 'all'
let modeUser = null; // la scelta vale per la persona collegata

export function ring(done, total) {
  const r = 21;
  const c = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  return `<svg class="ring" viewBox="0 0 52 52" aria-hidden="true">
    <circle cx="26" cy="26" r="${r}" fill="none" stroke="#E2F3DC" stroke-width="6"/>
    <circle cx="26" cy="26" r="${r}" fill="none" stroke="#48AB33" stroke-width="6" stroke-linecap="round"
      stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - pct)).toFixed(2)}" transform="rotate(-90 26 26)"/>
    <text x="26" y="30.5" text-anchor="middle" font-size="12.5" font-weight="800" fill="#1E1E1E" font-family="inherit">${Math.round(pct * 100)}%</text>
  </svg>`;
}

export function render() {
  const user = store.currentUser();
  const t = todayISO();
  day ??= t;
  if (modeUser !== user.id) { mode = null; day = t; modeUser = user.id; }
  mode ??= user.field && !store.isAdmin() ? 'mine' : 'all';
  const memberId = user.field && mode === 'mine' ? user.id : null;

  const jobs = store.jobsOn(day, memberId);
  const events = store.eventsOn(day, memberId);
  const admin = store.can('gestione');
  const done = jobs.filter(store.isDone).length;
  const overdue = day === t ? store.overdueJobs(memberId) : [];

  const groups = [];
  for (const j of jobs) {
    let g = groups.find((x) => x.condoId === j.condoId);
    if (!g) groups.push((g = { condoId: j.condoId, jobs: [] }));
    g.jobs.push(j);
  }
  // prima i condomini con lavori ancora da fare
  groups.sort((a, b) => (a.jobs.every(store.isDone) ? 1 : 0) - (b.jobs.every(store.isDone) ? 1 : 0));

  const rel = diffDays(t, day);
  const relLabel = rel === 0 ? 'Oggi' : rel === 1 ? 'Domani' : rel === -1 ? 'Ieri' : rel > 0 ? `Tra ${rel} giorni` : `${-rel} giorni fa`;

  const html = `
    <div class="daynav">
      <button class="icon-btn" data-day="-1" aria-label="Giorno precedente">${icon('left')}</button>
      <div class="daynav-center"><span class="daynav-rel">${relLabel}</span><strong>${fmtLong(day)}</strong></div>
      <button class="icon-btn" data-day="1" aria-label="Giorno successivo">${icon('right')}</button>
    </div>

    ${user.field || day !== t || admin ? `
    <div class="row-between wrap" style="min-height:40px">
      ${user.field ? `<div class="seg"><button class="${mode === 'mine' ? 'on' : ''}" data-mode="mine">I miei lavori</button><button class="${mode === 'all' ? 'on' : ''}" data-mode="all">Tutta la squadra</button></div>` : '<span></span>'}
      <span class="row" style="gap:4px">
        ${day !== t ? `<button class="link-btn" data-day="0">${icon('today')}Oggi</button>` : ''}
        ${admin ? `<button class="link-btn" data-new-event>${icon('plus')}Appuntamento</button>` : ''}
      </span>
    </div>` : ''}

    ${events.length ? `
      <div class="section" style="margin-top:12px">
        ${sectionHead(`Appuntamenti e promemoria (${events.length})`)}
        <div class="list list-2">${events.map((ev) => eventCard(ev)).join('')}</div>
      </div>` : ''}

    ${jobs.length ? `
      <div class="card day-progress">
        ${ring(done, jobs.length)}
        <div class="grow">
          <strong>${done} di ${jobs.length} ${jobs.length === 1 ? 'lavoro fatto' : 'lavori fatti'}</strong>
          <p class="small muted">${plural(groups.length, 'condominio', 'condomini')} da visitare</p>
        </div>
      </div>` : ''}

    <div class="stops-grid">
    ${groups.map((g, i) => {
      const condo = store.condoById(g.condoId);
      const address = condo ? [condo.address, condo.city].filter(Boolean).join(', ') : '';
      return `
      <section class="stop">
        <header class="stop-head">
          <span class="stop-num">${g.jobs.every(store.isDone) ? icon('check') : i + 1}</span>
          <a class="grow" href="#/condomini/${g.condoId}" style="min-width:0">
            <h3 class="ellipsis">${esc(condo?.name || '')}</h3>
            <p>${esc(address)}</p>
          </a>
          ${address ? `<a class="btn btn-soft btn-sm" href="${mapsUrl(address)}" target="_blank" rel="noopener">${icon('nav')}Naviga</a>` : ''}
        </header>
        <div class="list">${g.jobs.map((j) => jobCard(j, { showCondo: false, actions: true })).join('')}</div>
      </section>`;
    }).join('')}
    </div>

    ${!jobs.length ? `<div class="card" ${events.length ? 'style="margin-top:22px"' : ''}>${
      events.length
        ? emptyState('sun', 'Nessun lavoro nei condomini', 'Ci sono solo gli appuntamenti qui sopra.')
        : memberId && !store.isAvailable(user, day)
        ? emptyState('sun', 'Giorno libero', `Lavori ${esc(daysLabel(user))}: i tuoi lavori li trovi in quei giorni.`)
        : emptyState('sun', day === t ? 'Nessun lavoro in programma oggi' : 'Nessun lavoro in programma', mode === 'mine' ? 'Prova a guardare i lavori di tutta la squadra.' : 'Controlla il calendario per i prossimi giorni.')
    }</div>` : ''}

    ${overdue.length ? `
      <div class="section">
        ${sectionHead(`In ritardo (${overdue.length})`)}
        <p class="small muted" style="margin:-4px 2px 10px">Lavori dei giorni scorsi non ancora fatti: falli oggi o rimandali.</p>
        <div class="list list-2">${overdue.map((j) => jobCard(j, { showDate: true, actions: true })).join('')}</div>
      </div>` : ''}
  `;

  return {
    title: 'Oggi',
    html,
    mount(root) {
      root.addEventListener('click', (e) => {
        const d = e.target.closest('[data-day]');
        if (d) {
          const n = Number(d.dataset.day);
          day = n === 0 ? todayISO() : addDays(day, n);
          rerender();
        }
        const m = e.target.closest('[data-mode]');
        if (m) { mode = m.dataset.mode; rerender(); }
        if (e.target.closest('[data-new-event]')) openEventForm({ date: day });
      });
    },
  };
}
