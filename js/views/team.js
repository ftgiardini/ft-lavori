// "Squadra" (solo titolare): cosa sta facendo ogni giardiniere, attività recenti,
// gestione delle persone con ruoli e password.
import * as store from '../store.js';
import { icon } from '../icons.js';
import { openSheet, toast, confirmDialog, isWide } from '../ui.js';
import { avatar, memberSub, progressBar, sectionHead, emptyState } from '../components.js';
import { WORK_COLORS, ROLES } from '../data.js';
import { showMember } from './calendar.js';
import { esc, todayISO, startOfWeek, addDays, fmtTime, fmtShort, fmtDuration, WEEKDAYS_SHORT } from '../utils.js';

export function render() {
  if (!store.can('squadra')) {
    return { title: 'Squadra', html: `<div class="card">${emptyState('lock', 'Accesso riservato', 'Questa schermata è disponibile solo per il titolare.')}</div>` };
  }
  const wide = isWide();
  const state = store.getState();
  const t = todayISO();
  const weekFrom = startOfWeek(t);
  const weekTo = addDays(weekFrom, 6);

  const people = state.team.filter((m) => m.field).map((m) => ({ m, s: store.memberStats(m.id, weekFrom, weekTo) }));

  const peopleSec = `
    <div class="section">
      ${sectionHead('Chi fa cosa', `<span class="small muted">settimana dal ${fmtShort(weekFrom)}</span>`)}
      <div class="people-grid">
        ${people.map(({ m, s }) => `
          <div class="card person-card">
            <div class="row">
              ${avatar(m, 'md')}
              <div class="grow">
                <h3>${esc(m.name)}</h3>
                <p class="small muted ellipsis">${esc(memberSub(m))}</p>
              </div>
              <button class="btn btn-soft btn-sm" data-calendar="${m.id}">${icon('calendar')}Calendario</button>
            </div>
            <div class="person-stats">
              <div><strong>${s.todayDone}/${s.today}</strong><small>oggi</small></div>
              <div><strong>${s.weekDone}/${s.week}</strong><small>settimana</small></div>
              <div class="${s.overdue ? 'is-red' : ''}"><strong>${s.overdue}</strong><small>in ritardo</small></div>
            </div>
            ${progressBar(s.weekDone, s.week, s.overdue ? 'amber' : '')}
          </div>`).join('')}
      </div>
    </div>`;

  const activity = store.recentActivity(wide ? 25 : 12);
  const activitySec = `
    <div class="section">
      ${sectionHead('Attività recenti')}
      ${activity.length ? `
      <div class="card card-flush divided">
        ${activity.map(({ job, entry }) => {
          const who = store.memberById(entry.by);
          const type = store.typeById(job.typeId);
          const condo = store.condoById(job.condoId);
          const verb = entry.type === 'fatto' ? 'ha fatto' : entry.type === 'rimandato' ? 'ha rimandato' : 'ha tolto la spunta a';
          const extra = entry.type === 'rimandato' && entry.to ? ` a ${fmtShort(entry.to)}${entry.reason ? ` · ${esc(entry.reason)}` : ''}` : '';
          const time = entry.type === 'fatto' && entry.minutes ? ` <span class="chip">${icon('clock')}${esc(fmtDuration(entry.minutes))}</span>` : '';
          return `
          <button class="activity-row" data-action="open-job" data-id="${job.id}">
            ${who ? avatar(who, 'sm') : `<span class="avatar avatar-sm" style="--c:#B5BDB6">?</span>`}
            <span class="grow">
              <span class="activity-text"><b>${esc(who?.name || 'Qualcuno')}</b> ${verb} <b>${esc(type.name)}</b>${extra}${time}</span>
              ${entry.note ? `<span class="small ellipsis" style="display:block">“${esc(entry.note)}”</span>` : ''}
              <span class="small muted ellipsis" style="display:block">${esc(condo?.name || '')} · ${fmtTime(entry.at)}</span>
            </span>
            <span class="activity-dot t-${entry.type}"></span>
          </button>`;
        }).join('')}
      </div>` : `<div class="week-empty">Ancora nessuna attività.</div>`}
    </div>`;

  const manageSec = `
    <div class="section">
      ${sectionHead('Persone e accessi', `<button class="link-btn" data-member="">${icon('plus')}Aggiungi</button>`)}
      <div class="card card-flush divided">
        ${state.team.map((m) => `
          <button class="menu-row" data-member="${m.id}">
            ${avatar(m, 'md')}
            <span class="grow"><strong>${esc(m.name)}</strong><small>${esc(memberSub(m))}</small></span>
            <span class="role-tag role-${m.role}">${esc(ROLES[m.role]?.label || '')}</span>
            ${icon('right')}
          </button>`).join('')}
      </div>
      <p class="small muted" style="margin:10px 4px 0">Qui imposti ruolo e password di ognuno. Se qualcuno dimentica la password, apri la sua scheda e scrivine una nuova.</p>
    </div>`;

  const html = `
    <div class="page-head"><h1>Squadra</h1><p>Solo tu vedi questa schermata</p></div>
    ${wide
      ? `<div class="cols"><div class="cols-main">${peopleSec}${activitySec}</div><aside class="cols-side">${manageSec}</aside></div>`
      : peopleSec + activitySec + manageSec}`;

  return {
    title: 'Squadra',
    // sul telefono la Squadra si apre da "Altro": la freccia riporta lì
    back: wide ? null : '#/altro',
    backLabel: 'Altro',
    html,
    mount(root) {
      root.addEventListener('click', (e) => {
        const cal = e.target.closest('[data-calendar]');
        if (cal) showMember(cal.dataset.calendar);
        const mb = e.target.closest('[data-member]');
        if (mb) openMemberSheet(mb.dataset.member);
      });
    },
  };
}

// ---------- Scheda persona (ruolo, giorni, password) ----------

export function openMemberSheet(id) {
  const me = store.currentUser();
  const m = id ? store.memberById(id) : { name: '', title: 'Giardiniere', role: 'giardiniere', field: true, color: WORK_COLORS[6] };
  const isMe = id && id === me?.id;
  let { role, field, color } = m;
  const days = new Set(m.days || []);

  const s = openSheet({
    title: id ? `Modifica ${m.name}` : 'Nuova persona',
    body: `
      <div class="field"><label for="mb-name">Nome</label><input id="mb-name" class="input" value="${esc(m.name)}" autocomplete="off"></div>
      <div class="field"><label for="mb-title">Mansione</label><input id="mb-title" class="input" value="${esc(m.title || '')}" placeholder="Es. Giardiniere"></div>
      <div class="field">
        <span class="label">Livello di accesso</span>
        ${isMe ? `<p class="small muted">${esc(ROLES[role].label)} · non puoi cambiare il tuo livello di accesso.</p>` : `
        <div class="role-options">
          ${Object.entries(ROLES).map(([key, r]) => `
            <button class="role-option ${role === key ? 'on' : ''}" data-r="${key}">
              <span class="role-tag role-${key}">${esc(r.label)}</span>
              <small>${esc(r.desc)}</small>
            </button>`).join('')}
        </div>`}
      </div>
      ${store.isCloud ? `
      <div class="field">
        <label for="mb-pass">${id ? 'Nuova password' : 'Password'}</label>
        <input id="mb-pass" class="input" type="text" autocomplete="new-password" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="${id ? 'Lascia vuoto per non cambiarla' : 'Scegli una password'}">
        <p class="hint">Maiuscole e minuscole sono indifferenti. Almeno ${store.MIN_PASSWORD} caratteri.${m.email ? ` Accesso: ${esc(m.email)}` : ''}</p>
      </div>` : ''}
      <div class="field"><span class="label">Va nei cantieri?</span>
        <div class="pick">
          <button data-f="1" class="${field ? 'on' : ''}">Sì, riceve lavori</button>
          <button data-f="0" class="${!field ? 'on' : ''}">No, solo ufficio</button>
        </div></div>
      <div class="field"><span class="label">Giorni in cui lavora</span>
        <div class="pick">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button data-day="${d}" class="${days.has(d) ? 'on' : ''}">${WEEKDAYS_SHORT[d]}</button>`).join('')}</div>
        <p class="hint">Nessun giorno selezionato = tutti i giorni lavorativi.</p></div>
      <div class="field"><span class="label">Colore</span><div class="pick">${WORK_COLORS.map((c) => `<button data-color="${c}" class="${c === color ? 'on' : ''}" style="width:38px;padding:0;justify-content:center" aria-label="Colore"><span class="avatar avatar-xs" style="--c:${c}"></span></button>`).join('')}</div></div>
      ${id && !isMe ? `<button class="link-btn" style="color:var(--red);margin-top:16px" data-remove>${icon('trash')}Rimuovi dalla squadra</button>` : ''}`,
    footer: `<button class="btn btn-ghost" data-close>Annulla</button><button class="btn btn-primary" data-ok>Salva</button>`,
  });

  let busy = false;
  const ok = s.el.querySelector('[data-ok]');
  s.el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const ds = b.dataset;
    if (ds.r) { role = ds.r; s.el.querySelectorAll('[data-r]').forEach((x) => x.classList.toggle('on', x === b)); }
    if (ds.f) { field = ds.f === '1'; b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); }
    if (ds.day) { const d = Number(ds.day); days.has(d) ? days.delete(d) : days.add(d); b.classList.toggle('on'); }
    if (ds.color) { color = ds.color; s.el.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === b)); }
    if ('remove' in ds && !busy && await confirmDialog({ title: `Rimuovere ${m.name}?`, message: 'Non potrà più entrare nell’app e verrà tolto dai lavori assegnati.', confirmText: 'Rimuovi', danger: true })) {
      busy = true;
      try {
        await store.removeMember(id);
        s.close();
        toast(`${m.name} rimosso dalla squadra`);
      } catch (err) {
        toast(err.message, { duration: 7000 });
      } finally {
        busy = false;
      }
    }
    if ('ok' in ds && !busy) {
      const name = s.el.querySelector('#mb-name').value.trim();
      const password = s.el.querySelector('#mb-pass')?.value.trim() || '';
      if (!name) { toast('Scrivi il nome'); return; }
      if (store.isCloud && !id && !password) { toast('Imposta una password'); return; }
      if (password && password.length < store.MIN_PASSWORD) { toast(`La password deve avere almeno ${store.MIN_PASSWORD} caratteri`); return; }
      const data = { ...(id ? { id } : {}), name, title: s.el.querySelector('#mb-title').value.trim(), role, field, color, days: [...days].sort((a, b) => a - b) };
      busy = true;
      ok.disabled = true;
      ok.textContent = 'Salvataggio…';
      try {
        if (id) {
          if (password) await store.setMemberPassword(id, password);
          store.saveMember(data);
        } else {
          await store.createMember(data, password);
        }
        s.close();
        toast(password ? `Salvato. Password di ${name}: ${password.toUpperCase()}` : 'Salvato', { duration: 8000 });
      } catch (err) {
        toast(err.message, { duration: 7000 });
        ok.disabled = false;
        ok.textContent = 'Salva';
      } finally {
        busy = false;
      }
    }
  });
}
