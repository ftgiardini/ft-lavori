// Calendario: vista mese (con i lavori del giorno scelto) e vista settimana.
import * as store from '../store.js';
import { icon } from '../icons.js';
import { rerender, isWide } from '../ui.js';
import { jobCard, eventCard, avatar, seasonChips } from '../components.js';
import { openAddChooser } from './event-sheet.js';
import { eventKind } from '../data.js';
import { esc, todayISO, addDays, startOfWeek, parseISO, toISO, fmtLong, fmtShort, MONTHS, WEEKDAYS_SHORT, seasonOf } from '../utils.js';

let mode = 'mese';
let cursor = null; // primo giorno del mese mostrato
let selected = null;
let weekStart = null;
let member; // undefined = non ancora scelto, null = tutti
let viewer = null; // persona collegata: cambiando persona si riparte dalle impostazioni iniziali

/** Apre il calendario settimanale filtrato su una persona (dalla schermata Squadra) */
export function showMember(id) {
  viewer = store.currentUser()?.id;
  member = id;
  mode = 'settimana';
  weekStart = startOfWeek(todayISO());
  location.hash = '#/calendario';
}

export function render() {
  const t = todayISO();
  const user = store.currentUser();
  const admin = store.isAdmin();
  if (viewer !== user.id) {
    viewer = user.id;
    member = undefined;
    mode = 'mese';
    selected = cursor = weekStart = null;
  }
  selected ??= t;
  cursor ??= `${t.slice(0, 7)}-01`;
  weekStart ??= startOfWeek(t);
  if (member === undefined) member = user.field && !admin ? user.id : null;

  // chi gestisce può filtrare anche su chi non va in cantiere (es. gli appuntamenti di Martina)
  const team = admin ? store.getState().team : store.fieldTeam();
  const filter = `
    <div class="pick cal-filter">
      <button class="${member === null ? 'on' : ''}" data-member="">${icon('users')}Tutti</button>
      ${team.map((m) => `<button class="${member === m.id ? 'on' : ''}" data-member="${m.id}">${avatar(m, 'xs')}${esc(m.name)}</button>`).join('')}
    </div>`;

  let title;
  let body;
  if (mode === 'mese') {
    const first = parseISO(cursor);
    const monthIdx = first.getMonth();
    const season = seasonOf(monthIdx + 1);
    title = `${MONTHS[monthIdx]} ${first.getFullYear()}`;
    const gridStart = startOfWeek(cursor);
    const daysInMonth = new Date(first.getFullYear(), monthIdx + 1, 0).getDate();
    const weeks = Math.ceil(((first.getDay() + 6) % 7 + daysInMonth) / 7);

    let cells = '';
    for (let i = 0; i < weeks * 7; i++) {
      const iso = addDays(gridStart, i);
      const d = parseISO(iso);
      const jobs = store.jobsOn(iso, member);
      const events = store.eventsOn(iso, member);
      const late = jobs.some((j) => !store.isDone(j) && iso < t);
      const cls = [
        d.getMonth() !== monthIdx && 'out',
        iso === t && 'today',
        iso === selected && 'sel',
        (d.getDay() === 0 || d.getDay() === 6) && 'weekend',
      ].filter(Boolean).join(' ');
      // sul telefono: puntini (quadratini = appuntamenti); da computer: le prime voci del giorno
      const items = [
        ...events.map((ev) => `<span class="ev ${ev.done ? 'done' : ''}" style="--c:${eventKind(ev.kind).color}" title="${esc(ev.title)}">${ev.time ? `${esc(ev.time)} ` : ''}${esc(ev.title)}</span>`),
        ...jobs.map((j) => `<span class="${store.isDone(j) ? 'done' : ''}" style="--c:${store.typeById(j.typeId).color}" title="${esc(store.condoById(j.condoId)?.name || '')}">${esc(store.typeById(j.typeId).name)}</span>`),
      ];
      cells += `
        <button class="cal-day ${cls}" data-select="${iso}" aria-label="${fmtLong(iso)}: ${jobs.length} lavori, ${events.length} appuntamenti">
          <span class="cal-num">${d.getDate()}</span>
          ${late ? '<span class="cal-late"></span>' : ''}
          <span class="cal-dots">${[
            ...events.slice(0, 3).map((ev) => `<i class="ev ${ev.done ? 'done' : ''}" style="--c:${eventKind(ev.kind).color}"></i>`),
            ...jobs.slice(0, 6 - Math.min(3, events.length)).map((j) => `<i class="${store.isDone(j) ? 'done' : ''}" style="--c:${store.typeById(j.typeId).color}"></i>`),
          ].join('')}</span>
          <span class="cal-items">
            ${items.slice(0, 3).join('')}
            ${items.length > 3 ? `<span style="--c:#858D87">+${items.length - 3} altri</span>` : ''}
          </span>
        </button>`;
    }

    const dayJobs = store.jobsOn(selected, member);
    const dayEvents = store.eventsOn(selected, member);
    const month = `
      <div class="row wrap" style="margin:-4px 2px 10px;gap:6px">${seasonChips([monthIdx + 1])}<span class="small muted">stagione del mese</span></div>
      <div class="card cal-card">
        <div class="cal-grid cal-dow">${['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map((w) => `<span>${w}</span>`).join('')}</div>
        <div class="cal-grid">${cells}</div>
      </div>`;
    const agenda = `
      <div class="section" id="agenda">
        <div class="section-head">
          <h2>${fmtLong(selected)}</h2>
          ${admin ? `<button class="link-btn" data-add="${selected}">${icon('plus')}Aggiungi</button>` : ''}
        </div>
        ${dayEvents.length ? `<div class="list">${dayEvents.map((ev) => eventCard(ev)).join('')}</div>` : ''}
        ${dayJobs.length
          ? `<div class="list" ${dayEvents.length ? 'style="margin-top:10px"' : ''}>${dayJobs.map((j) => jobCard(j, { actions: true })).join('')}</div>`
          : dayEvents.length ? '' : `<div class="week-empty">Niente in programma in questo giorno.</div>`}
      </div>`;
    // Da computer: calendario a sinistra, lavori del giorno scelto a destra
    body = isWide()
      ? `<div class="cols cols-cal"><div class="cols-main">${month}</div><aside class="cols-side cols-sticky">${agenda}</aside></div>`
      : month + agenda;
  } else {
    const end = addDays(weekStart, 6);
    title = `${parseISO(weekStart).getDate()} ${fmtShort(weekStart).split(' ')[2]} – ${fmtShort(end).split(' ').slice(1).join(' ')}`;
    body = '';
    for (let i = 0; i < 7; i++) {
      const iso = addDays(weekStart, i);
      const jobs = store.jobsOn(iso, member);
      const events = store.eventsOn(iso, member);
      const done = jobs.filter(store.isDone).length;
      // salta i giorni non lavorativi (es. domenica) se non c'è niente in programma
      if (!store.getState().settings.workDays.includes(parseISO(iso).getDay()) && !jobs.length && !events.length) continue;
      body += `
        <section class="week-day ${iso === t ? 'today' : ''}">
          <header class="week-day-head">
            <strong>${WEEKDAYS_SHORT[parseISO(iso).getDay()]} ${parseISO(iso).getDate()}${iso === t ? ' · Oggi' : ''}</strong>
            <span class="row small muted">${jobs.length ? `${done}/${jobs.length} fatti` : ''}${admin ? `<button class="link-btn" data-add="${iso}" aria-label="Aggiungi">${icon('plus')}</button>` : ''}</span>
          </header>
          ${events.length ? `<div class="list">${events.map((ev) => eventCard(ev)).join('')}</div>` : ''}
          ${jobs.length ? `<div class="list" ${events.length ? 'style="margin-top:10px"' : ''}>${jobs.map((j) => jobCard(j, { actions: true })).join('')}</div>` : events.length ? '' : '<div class="week-empty">Niente in programma</div>'}
        </section>`;
    }
    // Da computer: i giorni della settimana affiancati
    if (isWide()) body = `<div class="week-grid">${body}</div>`;
  }

  const html = `
    <div class="cal-toolbar">
      <div class="cal-title">
        <button class="icon-btn" data-move="-1" aria-label="Precedente">${icon('left')}</button>
        <h2>${title}</h2>
        <button class="icon-btn" data-move="1" aria-label="Successivo">${icon('right')}</button>
      </div>
      <div class="row">
        <button class="btn btn-ghost btn-sm" data-today>Oggi</button>
        <div class="seg"><button class="${mode === 'mese' ? 'on' : ''}" data-mode="mese">Mese</button><button class="${mode === 'settimana' ? 'on' : ''}" data-mode="settimana">Settimana</button></div>
      </div>
    </div>
    ${filter}
    ${body}`;

  return {
    title: 'Calendario',
    html,
    mount(root) {
      root.addEventListener('click', (e) => {
        const el = e.target.closest('[data-select],[data-move],[data-mode],[data-member],[data-today],[data-add]');
        if (!el) return;
        if (el.dataset.select) {
          selected = el.dataset.select;
          if (selected.slice(0, 7) !== cursor.slice(0, 7)) cursor = `${selected.slice(0, 7)}-01`;
          rerender();
          if (window.innerWidth < 700) setTimeout(() => document.getElementById('agenda')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
        } else if (el.dataset.move) {
          const n = Number(el.dataset.move);
          if (mode === 'mese') {
            const d = parseISO(cursor);
            d.setMonth(d.getMonth() + n);
            cursor = toISO(d);
          } else {
            weekStart = addDays(weekStart, 7 * n);
          }
          rerender();
        } else if (el.dataset.mode) {
          mode = el.dataset.mode;
          if (mode === 'settimana') weekStart = startOfWeek(selected);
          rerender();
        } else if ('member' in el.dataset) {
          member = el.dataset.member || null;
          rerender();
        } else if ('today' in el.dataset) {
          selected = todayISO();
          cursor = `${selected.slice(0, 7)}-01`;
          weekStart = startOfWeek(selected);
          rerender();
        } else if (el.dataset.add) {
          openAddChooser(el.dataset.add);
        }
      });
    },
  };
}
