// "Registro lavori" (Nicolas, Martina, Alessandro): cosa ha fatto ogni giardiniere,
// in che giorno, in quanto tempo e cosa ha scritto. Totali di ore e lavori per persona.
import * as store from '../store.js';
import { icon } from '../icons.js';
import { rerender, isWide } from '../ui.js';
import { avatar, sectionHead, emptyState } from '../components.js';
import { esc, todayISO, startOfWeek, fmtShort, fmtDuration, plural } from '../utils.js';

let period = 'settimana';
let person = null;

const PERIODS = [
  ['oggi', 'Oggi'],
  ['settimana', 'Settimana'],
  ['mese', 'Mese'],
  ['tutto', 'Tutto'],
];

function range() {
  const t = todayISO();
  if (period === 'oggi') return { from: t, to: t, label: 'oggi' };
  if (period === 'settimana') return { from: startOfWeek(t), to: t, label: 'questa settimana' };
  if (period === 'mese') return { from: `${t.slice(0, 7)}-01`, to: t, label: 'questo mese' };
  return { from: null, to: null, label: 'in totale' };
}

export function render() {
  if (!store.can('gestione')) {
    return { title: 'Registro lavori', html: `<div class="card">${emptyState('lock', 'Accesso riservato')}</div>` };
  }
  const wide = isWide();
  const r = range();
  const all = store.workLog({ from: r.from, to: r.to });
  const list = person ? all.filter((x) => x.by === person || x.team.includes(person)) : all;
  const crew = store.fieldTeam();

  // totali per persona: lavori a cui ha partecipato e ore registrate
  const totals = crew.map((m) => {
    const mine = all.filter((x) => x.by === m.id || x.team.includes(m.id));
    return { m, count: mine.length, minutes: mine.reduce((a, x) => a + (x.minutes || 0), 0), missing: mine.filter((x) => !x.reported).length };
  });
  const tot = { count: list.length, minutes: list.reduce((a, x) => a + (x.minutes || 0), 0), missing: list.filter((x) => !x.reported).length };

  const html = `
    <div class="page-head"><h1>Registro lavori</h1><p>Cosa ha fatto la squadra, in quanto tempo e con quali note</p></div>

    <div class="seg seg-wide" style="margin-bottom:12px">
      ${PERIODS.map(([id, l]) => `<button class="${period === id ? 'on' : ''}" data-period="${id}">${l}</button>`).join('')}
    </div>

    <div class="kpis">
      <div class="kpi kpi-hero">
        <span class="kpi-ic">${icon('check')}</span>
        <span class="kpi-num">${tot.count}</span>
        <span class="kpi-label">Lavori fatti</span>
        <span class="kpi-sub">${esc(r.label)}</span>
      </div>
      <div class="kpi">
        <span class="kpi-ic">${icon('clock')}</span>
        <span class="kpi-num kpi-money">${tot.minutes ? esc(fmtDuration(tot.minutes)) : '0 h'}</span>
        <span class="kpi-label">Ore registrate</span>
        <span class="kpi-sub">${esc(r.label)}</span>
      </div>
      <div class="kpi ${tot.missing ? 'kpi-amber' : ''}">
        <span class="kpi-ic">${icon('alert')}</span>
        <span class="kpi-num">${tot.missing}</span>
        <span class="kpi-label">Senza dettagli</span>
        <span class="kpi-sub">non hanno scritto tempo o note</span>
      </div>
    </div>

    <div class="section">
      ${sectionHead('Per persona')}
      <div class="person-totals">
        <button class="person-total ${person === null ? 'on' : ''}" data-person="">
          <span class="avatar avatar-sm" style="--c:#163B1C">${icon('users')}</span>
          <span class="grow"><strong>Tutti</strong><small>${plural(all.length, 'lavoro', 'lavori')}</small></span>
        </button>
        ${totals.map(({ m, count, minutes, missing }) => `
        <button class="person-total ${person === m.id ? 'on' : ''}" data-person="${m.id}">
          ${avatar(m, 'sm')}
          <span class="grow"><strong>${esc(m.name)}</strong><small>${plural(count, 'lavoro', 'lavori')} · ${minutes ? esc(fmtDuration(minutes)) : '0 h'}${missing ? ` · <span class="is-amber">${missing} senza dettagli</span>` : ''}</small></span>
        </button>`).join('')}
      </div>
    </div>

    <div class="section">
      ${sectionHead(person ? `Lavori di ${esc(store.memberById(person)?.name || '')}` : 'Tutti i lavori fatti')}
      ${list.length ? `
      <div class="card card-flush divided log-list ${wide ? 'log-wide' : ''}">
        ${list.map((x) => {
          const who = store.memberById(x.by);
          const names = x.team.map((id) => store.memberById(id)?.name).filter(Boolean);
          return `
          <button class="log-row" data-action="${x.kind === 'job' ? 'open-job' : 'open-event'}" data-id="${x.id}">
            <span class="log-date"><strong>${x.date ? Number(x.date.slice(8, 10)) : '—'}</strong><small>${x.date ? esc(fmtShort(x.date).split(' ')[2]) : ''}</small></span>
            <span class="grow" style="min-width:0">
              <span class="log-title"><i style="--c:${x.color}"></i><b>${esc(x.title)}</b>${x.where ? ` · ${esc(x.where)}` : ''}${x.kind === 'event' ? ' <span class="chip">extra</span>' : ''}</span>
              <span class="log-note ${x.note ? '' : 'is-amber'}">${x.note ? `“${esc(x.note)}”` : 'Non ha scritto cosa ha fatto'}</span>
              <span class="small muted" style="display:block">${x.minutes ? `${icon('clock')} ${esc(fmtDuration(x.minutes))}` : '<span class="is-amber">tempo non indicato</span>'} · ${esc(names.join(', ') || who?.name || '')}</span>
            </span>
            ${who ? avatar(who, 'sm') : ''}
          </button>`;
        }).join('')}
      </div>` : `<div class="card">${emptyState('list', 'Nessun lavoro registrato', `Quando i giardinieri toccano “Fatto · registra” sui loro lavori, qui compare cosa hanno fatto e in quanto tempo.`)}</div>`}
    </div>`;

  return {
    title: 'Registro lavori',
    html,
    mount(root) {
      root.addEventListener('click', (e) => {
        const p = e.target.closest('[data-period]');
        if (p) { period = p.dataset.period; rerender(); }
        const m = e.target.closest('[data-person]');
        if (m) { person = m.dataset.person || null; rerender(); }
      });
    },
  };
}

/** Riepilogo per le Home: quanti lavori e ore registrate oggi/settimana */
export function summaryCard() {
  const t = todayISO();
  const week = store.workLog({ from: startOfWeek(t), to: t });
  const today = week.filter((x) => x.date === t);
  const minutes = week.reduce((a, x) => a + (x.minutes || 0), 0);
  const missing = week.filter((x) => !x.reported).length;
  return `
    <a class="card log-summary" href="#/registro">
      <span class="option-ic">${icon('list')}</span>
      <span class="grow">
        <strong>Registro lavori della squadra</strong>
        <small>Oggi ${plural(today.length, 'lavoro fatto', 'lavori fatti')} · settimana ${week.length} lavori, ${minutes ? esc(fmtDuration(minutes)) : '0 h'}${missing ? ` · <span class="is-amber">${missing} senza dettagli</span>` : ''}</small>
      </span>
      ${icon('right')}
    </a>`;
}
