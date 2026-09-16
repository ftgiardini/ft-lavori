// Elenco condomini e scheda del singolo condominio con l'avanzamento del contratto.
import * as store from '../store.js';
import { icon } from '../icons.js';
import { rerender, confirmDialog, toast, isWide } from '../ui.js';
import { jobCard, progressBar, sectionHead, typeIcon, seasonChips, avatar, emptyState } from '../components.js';
import { openAddJobSheet } from './job-sheet.js';
import { planLabel } from '../scheduler.js';
import { condoPaymentsSection, bindPaymentClicks } from './payments.js';
import { esc, todayISO, relDay, fmtDateNum, monthsLabel, mapsUrl, plural } from '../utils.js';

let query = '';
let showAllHistory = false;

export function renderList() {
  const admin = store.isAdmin();
  const q = query.trim().toLowerCase();
  const haystack = (c) => `${c.name} ${c.address} ${c.city}`.toLowerCase();
  const condos = store.getState().condos
    .map((c) => ({ c, s: store.condoStats(c) }))
    .sort((a, b) => a.c.name.localeCompare(b.c.name));

  const html = `
    <div class="page-head">
      <h1>Condomini</h1>
      <p>${plural(store.getState().condos.length, 'condominio sotto contratto', 'condomini sotto contratto')}</p>
    </div>
    <div class="toolbar">
      <label class="search">${icon('search')}<input class="input" type="search" placeholder="Cerca per nome o via" value="${esc(query)}" data-search></label>
      ${admin ? `<a class="btn btn-primary desktop-only" href="#/condomini/nuovo">${icon('plus')}Nuovo condominio</a>` : ''}
    </div>
    <div class="condo-grid">
      ${condos.map(({ c, s }) => `
        <a class="card condo-card" href="#/condomini/${c.id}" data-name="${esc(haystack(c))}" ${q && !haystack(c).includes(q) ? 'hidden' : ''}>
          <div class="row">
            <span class="condo-ic">${icon('building')}</span>
            <div class="grow">
              <h3 class="ellipsis">${esc(c.name)}</h3>
              <p class="small muted ellipsis">${esc([c.address, c.city].filter(Boolean).join(', '))}</p>
            </div>
            ${s.overdue ? `<span class="chip chip-red">${icon('alert')}${s.overdue}</span>` : ''}
          </div>
          <div class="condo-progress">
            <div class="row-between"><span class="muted">Fatti ${s.done} di ${s.total}</span><strong class="strong">${s.pct}%</strong></div>
            ${progressBar(s.done, s.total, s.overdue ? 'amber' : '')}
          </div>
          <div class="row-between condo-foot">
            <span>Mancano <b class="strong">${s.remaining}</b> interventi</span>
            <span>${s.next ? `Prossimo: ${relDay(s.next.date)}` : 'Nessun intervento in programma'}</span>
          </div>
        </a>`).join('')}
    </div>
    ${!condos.length ? `<div class="card">${emptyState('building', 'Nessun condominio', admin ? 'Tocca + per aggiungere il primo condominio.' : '')}</div>` : ''}
    ${admin ? `<a class="fab" href="#/condomini/nuovo" aria-label="Nuovo condominio">${icon('plus')}</a>` : ''}
  `;

  return {
    title: 'Condomini',
    html,
    mount(root) {
      // filtro sul posto, senza ridisegnare (così la tastiera dell'iPhone non si chiude)
      const input = root.querySelector('[data-search]');
      input.addEventListener('input', () => {
        query = input.value;
        const val = query.trim().toLowerCase();
        root.querySelectorAll('[data-name]').forEach((el) => { el.hidden = !!val && !el.dataset.name.includes(val); });
      });
    },
  };
}

/** Scheda semplice per i giardinieri: dove si trova, note utili, prossimi lavori */
function renderFieldDetail(condo) {
  const user = store.currentUser();
  const address = [condo.address, condo.city].filter(Boolean).join(', ');
  const mine = store.jobsOfCondo(condo.id)
    .filter((j) => !store.isDone(j) && j.date && store.matchesMember(j, user.id))
    .sort(store.byDate)
    .slice(0, 6);
  const html = `
    <button class="back-link" data-back>${icon('left')}Indietro</button>
    <div class="detail-head">
      <span class="condo-ic condo-ic-lg">${icon('building')}</span>
      <div class="grow">
        <h1>${esc(condo.name)}</h1>
        <p>${esc(address)}</p>
      </div>
    </div>
    ${address ? `<a class="btn btn-primary btn-block" href="${mapsUrl(address)}" target="_blank" rel="noopener">${icon('nav')}Portami qui</a>` : ''}
    ${condo.notes ? `
    <div class="section">
      ${sectionHead('Note utili')}
      <div class="card"><p>${esc(condo.notes)}</p></div>
    </div>` : ''}
    <div class="section">
      ${sectionHead('Chi segue questo condominio')}
      <div class="card row wrap" style="gap:10px">
        ${condo.team.map((m) => store.memberById(m)).filter(Boolean).map((m) => `<span class="row" style="gap:6px">${avatar(m, 'sm')}${esc(m.name)}</span>`).join('') || '<span class="muted">Non assegnato</span>'}
      </div>
    </div>
    <div class="section">
      ${sectionHead('I tuoi prossimi lavori qui')}
      ${mine.length ? `<div class="list">${mine.map((j) => jobCard(j, { showDate: true, showCondo: false, actions: true })).join('')}</div>` : '<div class="week-empty">Nessun lavoro in programma per te.</div>'}
    </div>`;
  return {
    title: condo.name,
    back: 'history',
    html,
    mount(root) {
      root.querySelector('[data-back]').addEventListener('click', () => {
        if (history.length > 1) history.back();
        else location.hash = '#/oggi';
      });
    },
  };
}

export function renderDetail(id) {
  const condo = store.condoById(id);
  if (!condo) {
    return { title: 'Condominio', back: '#/condomini', backLabel: 'Condomini', html: `<a class="back-link" href="#/condomini">${icon('left')}Condomini</a><div class="card">${emptyState('building', 'Condominio non trovato')}</div>` };
  }
  if (!store.isAdmin()) return renderFieldDetail(condo);

  const wide = isWide();
  const admin = store.isAdmin();
  const t = todayISO();
  const s = store.condoStats(condo);
  const address = [condo.address, condo.city].filter(Boolean).join(', ');
  const jobs = store.jobsOfCondo(id);
  const upcoming = jobs.filter((j) => !store.isDone(j)).sort(store.byDate);
  const history = jobs.filter(store.isDone).sort((a, b) => b.date.localeCompare(a.date));
  const upcomingLimit = wide ? 12 : 8;
  const shownHistory = showAllHistory ? history : history.slice(0, 5);

  const head = `
    <a class="back-link" href="#/condomini">${icon('left')}Condomini</a>
    <div class="detail-head">
      <span class="condo-ic condo-ic-lg">${icon('building')}</span>
      <div class="grow">
        <h1>${esc(condo.name)}</h1>
        <p>${esc(address)}</p>
      </div>
      ${wide && admin ? `<a class="btn btn-ghost" href="#/condomini/${id}/modifica">${icon('edit')}Modifica</a>` : ''}
    </div>`;

  const quick = `
    <div class="quick-actions">
      <a class="qa ${address ? '' : 'disabled'}" href="${address ? mapsUrl(address) : '#'}" target="_blank" rel="noopener">${icon('nav')}Naviga</a>
      <a class="qa ${condo.phone ? '' : 'disabled'}" href="tel:${esc((condo.phone || '').replace(/[^\d+]/g, ''))}">${icon('phone')}Chiama</a>
      ${admin && !wide ? `<a class="qa" href="#/condomini/${id}/modifica">${icon('edit')}Modifica</a>` : `<a class="qa ${condo.email ? '' : 'disabled'}" href="mailto:${esc(condo.email || '')}">${icon('mail')}Email</a>`}
    </div>`;

  const progress = `
    <div class="card">
      <div class="row-between"><span class="strong">Avanzamento contratto</span><span class="strong">${s.pct}%</span></div>
      <div style="margin:10px 0 8px">${progressBar(s.done, s.total, s.overdue ? 'amber' : '')}</div>
      <div class="row wrap small" style="gap:6px">
        <span class="chip chip-green">${icon('check')}${s.done} fatti</span>
        <span class="chip">${icon('clock')}${s.remaining} mancano</span>
        ${s.overdue ? `<span class="chip chip-red">${icon('alert')}${s.overdue} in ritardo</span>` : ''}
        ${s.unscheduled ? `<span class="chip chip-amber">${icon('calendar')}${s.unscheduled} senza data</span>` : ''}
      </div>
    </div>`;

  const worksSec = `
    <div class="section">
      ${sectionHead('Lavori del contratto')}
      <div class="works-grid">
      ${condo.works.map((w) => {
        const type = store.typeById(w.typeId);
        const ws = store.workStats(condo, w);
        return `
        <div class="card work-card">
          <div class="row">
            ${typeIcon(type)}
            <div class="grow">
              <h3>${esc(type.name)}</h3>
              <div class="work-period">${icon('calendar')}${monthsLabel(w.months)} ${seasonChips(w.months)}</div>
              <div class="small muted">${esc(planLabel(w.plan))}</div>
            </div>
            <div class="work-count"><strong>${ws.done}/${w.qty}</strong><small>fatti</small></div>
          </div>
          ${progressBar(ws.done, w.qty, ws.overdue ? 'amber' : '')}
          <div class="work-foot">
            <span>Mancano <b class="strong">${ws.remaining}</b></span>
            ${ws.next ? `<span class="muted">· prossimo ${relDay(ws.next.date)}</span>` : ''}
            ${ws.overdue ? `<span class="chip chip-red">${ws.overdue} in ritardo</span>` : ''}
            ${ws.unscheduled ? `<span class="chip chip-amber">${ws.unscheduled} senza data</span>` : ''}
            ${w.doneBefore ? `<span class="chip">${w.doneBefore} fatti prima dell'app</span>` : ''}
          </div>
          ${w.notes ? `<p class="small muted" style="margin-top:8px">${esc(w.notes)}</p>` : ''}
        </div>`;
      }).join('')}
      </div>
      ${!condo.works.length ? `<div class="card">${emptyState('list', 'Nessun lavoro a contratto')}</div>` : ''}
    </div>`;

  const info = `
    <div class="section">
      ${wide ? sectionHead('Dati del condominio') : ''}
      <div class="card card-flush divided">
        <div class="info-row">${icon('file')}<div class="grow"><span class="label">Contratto</span><span class="value">dal ${fmtDateNum(condo.contractStart)} al ${fmtDateNum(condo.contractEnd)}</span></div></div>
        <div class="info-row">${icon('user')}<div class="grow"><span class="label">Amministratore</span><span class="value">${esc(condo.adminName || '—')}</span>${condo.phone ? `<span class="small muted" style="display:block">${esc(condo.phone)}${condo.email ? ` · ${esc(condo.email)}` : ''}</span>` : ''}</div></div>
        <div class="info-row">${icon('users')}<div class="grow"><span class="label">Squadra</span><span class="value row wrap" style="gap:6px">${condo.team.length ? condo.team.map((m) => store.memberById(m)).filter(Boolean).map((m) => `<span class="row" style="gap:5px">${avatar(m, 'xs')}${esc(m.name)}</span>`).join('') : 'Non assegnata'}</span></div></div>
        ${condo.notes ? `<div class="info-row">${icon('note')}<div class="grow"><span class="label">Note</span><span class="value" style="font-weight:500">${esc(condo.notes)}</span></div></div>` : ''}
      </div>
    </div>`;

  const upcomingSec = `
    <div class="section">
      ${sectionHead(`Da fare (${upcoming.length})`, admin ? `<button class="link-btn" data-add-job>${icon('plus')}Aggiungi</button>` : '')}
      ${upcoming.length ? `<div class="list ${wide ? 'list-2' : ''}">${upcoming.slice(0, upcomingLimit).map((j) => jobCard(j, { showDate: true, showCondo: false, actions: true })).join('')}</div>` : `<div class="week-empty">Tutti gli interventi sono stati fatti.</div>`}
      ${upcoming.length > upcomingLimit ? `<p class="small muted" style="margin:8px 2px">E altri ${upcoming.length - upcomingLimit} nel calendario.</p>` : ''}
    </div>`;

  const historySec = `
    <div class="section">
      ${sectionHead(`Fatti (${history.length})`)}
      ${history.length ? `<div class="list">${shownHistory.map((j) => jobCard(j, { showDate: true, showCondo: false })).join('')}</div>` : `<div class="week-empty">Ancora nessun intervento fatto.</div>`}
      ${history.length > 5 ? `<button class="link-btn" style="margin-top:8px" data-history>${showAllHistory ? 'Mostra meno' : `Mostra tutti (${history.length})`}</button>` : ''}
    </div>`;

  const adminSec = admin ? `
    <div class="section">
      <div class="card card-flush divided">
        <button class="menu-row" data-replan>
          <span class="row-ic">${icon('sparkles')}</span>
          <span class="grow"><strong>Ripianifica automaticamente</strong><small>Ridistribuisce da oggi gli interventi che mancano</small></span>
          ${icon('right')}
        </button>
        ${store.can('elimina') ? `
        <button class="menu-row danger" data-delete>
          <span class="row-ic">${icon('trash')}</span>
          <span class="grow"><strong>Elimina condominio</strong><small>Cancella anche tutti i suoi interventi</small></span>
        </button>` : ''}
      </div>
    </div>` : '';

  const paymentsSec = condoPaymentsSection(condo);

  const html = wide
    ? `${head}
      <div class="cols">
        <div class="cols-main">${progress}${paymentsSec}${worksSec}${upcomingSec}</div>
        <aside class="cols-side">${quick}${info}${historySec}${adminSec}</aside>
      </div>`
    : `${head}${quick}${progress}${paymentsSec}${worksSec}${info}${upcomingSec}${historySec}${adminSec}`;

  return {
    title: condo.name,
    back: '#/condomini',
    backLabel: 'Condomini',
    html,
    mount(root) {
      bindPaymentClicks(root);
      root.addEventListener('click', async (e) => {
        if (e.target.closest('a.disabled')) e.preventDefault();
        if (e.target.closest('[data-history]')) { showAllHistory = !showAllHistory; rerender(); }
        if (e.target.closest('[data-add-job]')) openAddJobSheet({ condoId: id, date: t });
        if (e.target.closest('[data-replan]')) {
          const ok = await confirmDialog({
            title: 'Ripianificare?',
            message: 'Gli interventi non ancora fatti verranno ridistribuiti da oggi a fine contratto. Spostamenti e assegnazioni fatti a mano su questi interventi andranno persi.',
            confirmText: 'Ripianifica',
          });
          if (ok) { store.replanCondo(id); toast('Calendario del condominio ricalcolato'); }
        }
        if (e.target.closest('[data-delete]') && store.can('elimina')) {
          const ok = await confirmDialog({ title: `Eliminare ${condo.name}?`, message: 'Verranno cancellati il condominio e tutti i suoi interventi, anche quelli già fatti. Non si può annullare.', confirmText: 'Elimina', danger: true });
          if (ok) { store.deleteCondo(id); location.hash = '#/condomini'; toast('Condominio eliminato'); }
        }
      });
    },
  };
}
