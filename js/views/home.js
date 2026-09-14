// Home per chi gestisce (Martina, Nicolas): situazione generale e cosa manca per ogni condominio.
// I giardinieri vedono direttamente "Oggi".
import * as store from '../store.js';
import { icon } from '../icons.js';
import { rerender, isWide } from '../ui.js';
import { jobCard, eventCard, progressBar, sectionHead, typeIcon, emptyState, avatar } from '../components.js';
import { openAddJobSheet } from './job-sheet.js';
import { openEventForm } from './event-sheet.js';
import * as today from './today.js';
import { esc, todayISO, fmtLong, startOfWeek, addDays, currentSeasonRange, fmtShort, parseISO } from '../utils.js';

let showAllOverdue = false;

const fatti = (n) => `${n} ${n === 1 ? 'fatto' : 'fatti'}`;

export function render() {
  if (!store.isAdmin()) return { ...today.render(), title: 'Oggi' };

  const wide = isWide();
  const user = store.currentUser();
  const state = store.getState();
  const t = todayISO();

  const todayJobs = store.jobsOn(t);
  const todayDone = todayJobs.filter(store.isDone).length;
  const overdue = store.overdueJobs();
  const unscheduled = store.unscheduledJobs();
  const weekFrom = startOfWeek(t);
  const week = store.jobsBetween(weekFrom, addDays(weekFrom, 6));
  const weekDone = week.filter(store.isDone).length;

  const condos = state.condos
    .map((c) => ({ c, s: store.condoStats(c) }))
    .sort((a, b) => b.s.overdue - a.s.overdue || a.s.pct - b.s.pct);
  const totals = condos.reduce((acc, { s }) => ({ total: acc.total + s.total, done: acc.done + s.done }), { total: 0, done: 0 });
  const pct = totals.total ? Math.round((totals.done / totals.total) * 100) : 0;

  const season = currentSeasonRange(t);
  const seasonRows = store.summaryByType(season.from, season.to);
  const hour = new Date().getHours();
  const greeting = hour < 13 ? 'Buongiorno' : hour < 18 ? 'Buon pomeriggio' : 'Buonasera';
  const overdueLimit = wide ? 6 : 4;
  const shownOverdue = showAllOverdue ? overdue : overdue.slice(0, overdueLimit);

  const actions = `
    <div class="hero-actions">
      <a class="btn btn-primary" href="#/condomini/nuovo">${icon('plus')}Nuovo condominio</a>
      <button class="btn btn-soft" data-new-event>${icon('bell')}Nuovo appuntamento</button>
      <button class="btn btn-ghost" data-add-job>${icon('calendar')}Aggiungi intervento</button>
      <a class="btn btn-ghost" href="#/preventivi">${icon('file')}Crea preventivo</a>
    </div>`;

  // Appuntamenti e promemoria di oggi e dei prossimi 7 giorni (di tutti)
  const upcoming = store.eventsBetween(t, addDays(t, 7)).filter((ev) => !ev.done || ev.date === t);
  const eventsSec = `
    <div class="section">
      ${sectionHead('Appuntamenti e promemoria', '<a class="link-btn" href="#/calendario">Calendario</a>')}
      ${upcoming.length
        ? `<div class="list">${upcoming.slice(0, 6).map((ev) => eventCard(ev, { showDate: true })).join('')}</div>
           ${upcoming.length > 6 ? `<p class="small muted" style="margin:8px 2px">E altri ${upcoming.length - 6} nel calendario.</p>` : ''}`
        : `<div class="week-empty">Nessun appuntamento nei prossimi 7 giorni. <button class="link-btn" data-new-event>${icon('plus')}Aggiungi</button></div>`}
    </div>`;

  const kpis = `
    <div class="kpis">
      <a class="kpi kpi-hero" href="#/oggi">
        <span class="kpi-ic">${icon('today')}</span>
        <span class="kpi-num">${todayJobs.length}</span>
        <span class="kpi-label">Lavori oggi</span>
        <span class="kpi-sub">${fatti(todayDone)}</span>
      </a>
      <button class="kpi ${overdue.length ? 'kpi-red' : ''}" data-scroll="overdue" style="text-align:left">
        <span class="kpi-ic">${icon('alert')}</span>
        <span class="kpi-num">${overdue.length}</span>
        <span class="kpi-label">In ritardo</span>
        <span class="kpi-sub">da riprogrammare</span>
      </button>
      <a class="kpi" href="#/calendario">
        <span class="kpi-ic">${icon('calendar')}</span>
        <span class="kpi-num">${week.length}</span>
        <span class="kpi-label">Questa settimana</span>
        <span class="kpi-sub">${fatti(weekDone)}</span>
      </a>
      <a class="kpi" href="#/condomini">
        <span class="kpi-ic">${icon('building')}</span>
        <span class="kpi-num">${pct}%</span>
        <span class="kpi-label">Contratti</span>
        <span class="kpi-sub">${totals.done} di ${totals.total} interventi</span>
      </a>
    </div>`;

  const overdueSec = overdue.length ? `
    <div class="section" id="overdue">
      ${sectionHead(`Da riprogrammare (${overdue.length})`)}
      <p class="small muted" style="margin:-4px 2px 10px">Lavori con la data passata ma non segnati come fatti.</p>
      <div class="list ${wide ? 'list-2' : ''}">${shownOverdue.map((j) => jobCard(j, { showDate: true, actions: true })).join('')}</div>
      ${overdue.length > overdueLimit ? `<button class="link-btn" style="margin-top:8px" data-toggle-overdue>${showAllOverdue ? 'Mostra meno' : `Mostra tutti (${overdue.length})`}</button>` : ''}
    </div>` : '';

  const unscheduledSec = unscheduled.length ? `
    <div class="section">
      ${sectionHead(`Senza data (${unscheduled.length})`)}
      <p class="small muted" style="margin:-4px 2px 10px">Non c'erano giorni disponibili nel periodo del contratto: tocca per scegliere una data.</p>
      <div class="list ${wide ? 'list-2' : ''}">${unscheduled.slice(0, 6).map((j) => jobCard(j)).join('')}</div>
    </div>` : '';

  const remainingSec = `
    <div class="section">
      ${sectionHead('Quanti lavori mancano', '<a class="link-btn" href="#/condomini">Tutti</a>')}
      ${condos.length ? `
      <div class="card card-flush divided">
        ${condos.map(({ c, s }) => `
          <a class="remain-row" href="#/condomini/${c.id}">
            <div class="remain-top">
              <h3>${esc(c.name)}</h3>
              ${s.overdue ? `<span class="chip chip-red">${s.overdue} in ritardo</span>` : ''}
              <span class="remain-pct">${s.pct}%</span>
            </div>
            ${progressBar(s.done, s.total, s.overdue ? 'amber' : '')}
            <div class="remain-chips">
              ${c.works.map((w) => {
                const type = store.typeById(w.typeId);
                const ws = store.workStats(c, w);
                const txt = ws.remaining === 0 ? `completato ${icon('check')}` : `${ws.remaining === 1 ? 'manca' : 'mancano'} <b>${ws.remaining}</b> su ${w.qty}`;
                return `<span class="remain-chip" style="--c:${type.color}"><i></i>${esc(type.name)}: ${txt}</span>`;
              }).join('')}
            </div>
          </a>`).join('')}
      </div>` : `<div class="card">${emptyState('building', 'Nessun condominio', 'Aggiungi il primo condominio con il suo contratto.')}</div>`}
    </div>`;

  const seasonSec = `
    <div class="section">
      ${sectionHead('Stagione in corso')}
      <div class="card card-flush">
        <div class="season-head" style="--c:${season.season.color}">
          <span class="type-ic type-ic-md" style="--c:${season.season.color}">${icon(season.season.icon)}</span>
          <div class="grow">
            <h3>${season.label}</h3>
            <p class="small muted">${fmtShort(season.from)} – ${fmtShort(season.to)} ${parseISO(season.to).getFullYear()}</p>
          </div>
        </div>
        <div class="divided">
          ${seasonRows.length ? seasonRows.map((r) => {
            const type = store.typeById(r.typeId);
            return `
            <div class="season-row">
              ${typeIcon(type, 'sm')}
              <div class="grow">
                <div class="row-between"><span class="strong">${esc(type.name)}</span><span class="muted">${r.done} / ${r.total}</span></div>
                ${progressBar(r.done, r.total)}
              </div>
            </div>`;
          }).join('') : `<div class="season-row muted">Nessun lavoro previsto in questa stagione.</div>`}
        </div>
      </div>
    </div>`;

  // Solo da computer: i lavori di oggi a colpo d'occhio nella colonna laterale
  const todaySec = `
    <div class="section">
      ${sectionHead(`Oggi · ${fatti(todayDone)} su ${todayJobs.length}`, '<a class="link-btn" href="#/oggi">Apri</a>')}
      ${todayJobs.length
        ? `<div class="list">${todayJobs.slice(0, 6).map((j) => jobCard(j)).join('')}</div>${todayJobs.length > 6 ? `<a class="link-btn" style="margin-top:8px" href="#/oggi">Altri ${todayJobs.length - 6}</a>` : ''}`
        : '<div class="week-empty">Nessun lavoro in programma oggi.</div>'}
    </div>`;

  const hello = `
    <div class="hello">
      <p class="hello-date">${fmtLong(t)}</p>
      <h1>${greeting}, ${esc(user.name)}</h1>
    </div>`;

  // Solo il titolare: a colpo d'occhio come sta andando la giornata di ognuno
  const weekTo = addDays(weekFrom, 6);
  const crew = store.can('squadra')
    ? state.team.filter((m) => m.field).map((m) => ({ m, s: store.memberStats(m.id, weekFrom, weekTo) }))
    : [];
  const crewSec = crew.length ? `
    <div class="section">
      ${sectionHead('La squadra oggi', '<a class="link-btn" href="#/squadra">Dettagli</a>')}
      <div class="card card-flush divided">
        ${crew.map(({ m, s }) => `
          <a class="crew-row" href="#/squadra">
            ${avatar(m, 'sm')}
            <span class="grow strong">${esc(m.name)}</span>
            ${s.overdue ? `<span class="chip chip-red">${s.overdue} in ritardo</span>` : ''}
            <span class="crew-count">${s.today ? `${s.todayDone}/${s.today}` : '<span class="muted">—</span>'}</span>
          </a>`).join('')}
      </div>
    </div>` : '';

  const html = wide
    ? `
      <div class="home-head">${hello}${actions}</div>
      ${kpis}
      <div class="cols">
        <div class="cols-main">${overdueSec}${unscheduledSec}${remainingSec}</div>
        <aside class="cols-side">${eventsSec}${crewSec}${todaySec}${seasonSec}</aside>
      </div>`
    : `${hello}${kpis}${actions}${eventsSec}${crewSec}${overdueSec}${unscheduledSec}${remainingSec}${seasonSec}`;

  return {
    title: 'Home',
    html,
    mount(root) {
      root.addEventListener('click', (e) => {
        if (e.target.closest('[data-scroll]')) document.getElementById('overdue')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (e.target.closest('[data-toggle-overdue]')) { showAllOverdue = !showAllOverdue; rerender(); }
        if (e.target.closest('[data-add-job]')) openAddJobSheet();
        if (e.target.closest('[data-new-event]')) openEventForm({ date: todayISO() });
      });
    },
  };
}
