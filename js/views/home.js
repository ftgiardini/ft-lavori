// Home per chi gestisce (Martina, Nicolas): situazione generale e cosa manca per ogni condominio.
// Alessandro (amministrazione) vede la stessa Home ma in ordine diverso: prima le scadenze
// dei contratti e gli appuntamenti, perché segue rinnovi e pagamenti.
// I giardinieri vedono direttamente "Oggi".
import * as store from '../store.js';
import { icon } from '../icons.js';
import { rerender, isWide } from '../ui.js';
import { jobCard, eventCard, progressBar, sectionHead, typeIcon, emptyState, avatar } from '../components.js';
import { openAddJobSheet } from './job-sheet.js';
import { openEventForm } from './event-sheet.js';
import { paymentRow, contactButtons, bindPaymentClicks, openPaymentForm } from './payments.js';
import { ROLES } from '../data.js';
import * as today from './today.js';
import { summaryCard } from './worklog.js';
import { esc, todayISO, fmtLong, fmtDateNum, fmtEuro, fmtDuration, relDay, startOfWeek, addDays, currentSeasonRange, fmtShort, parseISO, plural } from '../utils.js';

let showAllOverdue = false;

const fatti = (n) => `${n} ${n === 1 ? 'fatto' : 'fatti'}`;

export function render() {
  if (!store.isAdmin()) return { ...today.render(), title: 'Oggi' };

  const wide = isWide();
  const user = store.currentUser();
  const amministra = ROLES[user.role]?.home === 'scadenze';
  const state = store.getState();
  const t = todayISO();

  const todayJobs = store.jobsOn(t);
  const todayDone = todayJobs.filter(store.isDone).length;
  const overdue = store.overdueJobs();
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

  const actions = amministra
    ? `
    <div class="hero-actions">
      <button class="btn btn-primary" data-new-payment>${icon('plus')}Nuovo pagamento</button>
      <a class="btn btn-soft" href="#/pagamenti">${icon('file')}Pagamenti e clienti</a>
      <button class="btn btn-ghost" data-new-event>${icon('bell')}Nuovo appuntamento</button>
      <a class="btn btn-ghost" href="#/calendario">${icon('calendar')}Calendario</a>
    </div>`
    : `
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

  // Contratti in scadenza (o già scaduti): rinnovo e fattura finale
  const deadlines = store.contractDeadlines(120);
  const expiring = deadlines.filter((x) => x.days >= 0).length;
  const expired = deadlines.filter((x) => x.days < 0).length;
  const deadlinesSec = `
    <div class="section" id="scadenze">
      ${sectionHead('Scadenze dei contratti', '<a class="link-btn" href="#/condomini">Tutti i condomini</a>')}
      <p class="small muted" style="margin:-4px 2px 10px">Contratti che finiscono entro 4 mesi: da rinnovare e da fatturare.</p>
      ${deadlines.length ? `
      <div class="card card-flush divided">
        ${deadlines.map(({ condo, days, stats }) => `
          <a class="deadline-row ${days < 0 ? 'is-late' : days <= 30 ? 'is-soon' : ''}" href="#/condomini/${condo.id}">
            <span class="deadline-when">
              <strong>${days < 0 ? 'Scaduto' : days === 0 ? 'Oggi' : days}</strong>
              <small>${days < 0 ? `da ${-days} g` : days === 0 ? 'scade' : days === 1 ? 'giorno' : 'giorni'}</small>
            </span>
            <span class="grow">
              <strong class="strong ellipsis">${esc(condo.name)}</strong>
              <span class="small muted" style="display:block">Fino al ${fmtDateNum(condo.contractEnd)}${condo.adminName ? ` · ${esc(condo.adminName)}` : ''}</span>
              <span class="small ${stats.remaining ? 'is-amber' : 'muted'}" style="display:block">${stats.remaining ? `Mancano ancora ${plural(stats.remaining, 'intervento', 'interventi')}` : 'Tutti gli interventi sono stati fatti'}</span>
            </span>
            ${icon('right')}
          </a>`).join('')}
      </div>` : `<div class="week-empty">Nessun contratto in scadenza nei prossimi 4 mesi.</div>`}
    </div>`;

  // ---------- Alessandro: contabilità, clienti e controllo dei lavori ----------
  const payTot = store.can('pagamenti') ? store.paymentTotals() : null;
  const toCall = store.can('pagamenti') ? store.clientsToCall() : [];
  const dueSoon = store.can('pagamenti') ? store.paymentsList('aperti').filter((p) => store.paymentStatus(p) === 'in-scadenza') : [];
  const checks = store.workChecks();
  const checkCount = checks.late.length + checks.noReport.length + checks.endedOpen.length;

  const kpisAmm = `
    <div class="kpis">
      <a class="kpi kpi-hero" href="#/pagamenti">
        <span class="kpi-ic">${icon('file')}</span>
        <span class="kpi-num kpi-money">${fmtEuro(payTot?.open || 0)}</span>
        <span class="kpi-label">Da incassare</span>
        <span class="kpi-sub">${plural(payTot?.openCount || 0, 'rata aperta', 'rate aperte')}</span>
      </a>
      <button class="kpi ${payTot?.lateCount ? 'kpi-red' : ''}" data-scroll="solleciti" style="text-align:left">
        <span class="kpi-ic">${icon('alert')}</span>
        <span class="kpi-num kpi-money">${fmtEuro(payTot?.late || 0)}</span>
        <span class="kpi-label">Pagamenti scaduti</span>
        <span class="kpi-sub">${plural(toCall.length, 'cliente da sollecitare', 'clienti da sollecitare')}</span>
      </button>
      <button class="kpi ${checkCount ? 'kpi-amber' : ''}" data-scroll="controlli" style="text-align:left">
        <span class="kpi-ic">${icon('list')}</span>
        <span class="kpi-num">${checkCount}</span>
        <span class="kpi-label">Lavori da controllare</span>
        <span class="kpi-sub">${checkCount ? 'ritardi e dati mancanti' : 'tutto in ordine'}</span>
      </button>
      <button class="kpi ${expired ? 'kpi-red' : ''}" data-scroll="scadenze" style="text-align:left">
        <span class="kpi-ic">${icon('calendar')}</span>
        <span class="kpi-num">${expiring + expired}</span>
        <span class="kpi-label">Contratti in scadenza</span>
        <span class="kpi-sub">${expired ? `${expired} già scaduti` : 'entro 4 mesi'}</span>
      </button>
    </div>`;

  const paySec = !store.can('pagamenti') ? '' : `
    <div class="section" id="solleciti">
      ${sectionHead('Pagamenti da sollecitare', '<a class="link-btn" href="#/pagamenti">Tutti i pagamenti</a>')}
      ${!store.paymentsAvailable() ? `<div class="plan-warn">${icon('alert')}<span>Per usare i pagamenti va rieseguito schema.sql su Supabase (vedi guida).</span></div>` : ''}
      ${toCall.length ? `<div class="client-grid">${toCall.map((x) => `
        <div class="card client-card">
          <a class="row" href="#/condomini/${x.condo.id}">
            <span class="grow" style="min-width:0"><strong class="strong ellipsis" style="display:block">${esc(x.condo.name)}</strong>
            <span class="small muted">${esc(x.condo.adminName || 'Amministratore non inserito')} · ${plural(x.count, 'rata', 'rate')} · dal ${fmtDateNum(x.oldest)}</span></span>
            <strong class="is-red-text">${fmtEuro(x.amount)}</strong>
          </a>
          ${contactButtons(x.condo, { remind: store.paymentsOfCondo(x.condo.id).filter((p) => store.paymentStatus(p) === 'scaduto') })}
        </div>`).join('')}</div>`
        : '<div class="week-empty">Nessun pagamento scaduto: tutti i clienti sono in regola.</div>'}
      ${dueSoon.length ? `
        <h3 class="sub-head">In scadenza nei prossimi 15 giorni</h3>
        <div class="card card-flush divided">${dueSoon.slice(0, 8).map((p) => paymentRow(p)).join('')}</div>` : ''}
    </div>`;

  const jobLink = (j, extra = '') => {
    const type = store.typeById(j.typeId);
    const condo = store.condoById(j.condoId);
    return `<button class="check-item" data-action="open-job" data-id="${j.id}"><i style="--c:${type.color}"></i><span class="grow ellipsis"><b>${esc(type.name)}</b> · ${esc(condo?.name || '')}</span><span class="small muted">${extra || esc(relDay(j.date))}</span></button>`;
  };
  const checksSec = `
    <div class="section" id="controlli">
      ${sectionHead('Controllo dei lavori')}
      <div class="card">
        <div class="pay-sum">
          <div><small>Fatti ultimi 30 giorni</small><strong>${checks.doneMonth}</strong></div>
          <div><small>Ore registrate</small><strong>${checks.minutesMonth ? fmtDuration(checks.minutesMonth) : '—'}</strong></div>
          <div class="${checks.late.length ? 'is-red' : ''}"><small>In ritardo</small><strong>${checks.late.length}</strong></div>
        </div>
      </div>
      ${checkCount ? `
      <div class="card card-flush check-list">
        ${checks.late.length ? `<div class="check-group"><h4>${icon('alert')}In ritardo, non ancora fatti (${checks.late.length})</h4>${checks.late.slice(0, 5).map((j) => jobLink(j)).join('')}</div>` : ''}
        ${checks.noReport.length ? `<div class="check-group"><h4>${icon('note')}Fatti senza dire cosa e in quanto tempo (${checks.noReport.length})</h4>${checks.noReport.slice(0, 5).map((j) => jobLink(j, esc(store.memberById(j.doneBy)?.name || ''))).join('')}</div>` : ''}
        ${checks.endedOpen.length ? `<div class="check-group"><h4>${icon('file')}Contratto finito con lavori mancanti (${checks.endedOpen.length})</h4>${checks.endedOpen.map((c) => `<a class="check-item" href="#/condomini/${c.id}"><i></i><span class="grow ellipsis"><b>${esc(c.name)}</b></span><span class="small muted">mancano ${store.condoStats(c).remaining}</span></a>`).join('')}</div>` : ''}
      </div>` : '<div class="week-empty">Nessun problema nei lavori: tutto in ordine.</div>'}
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

  // Interventi da programmare: uno per lavoro (il prossimo), da mettere in calendario uno alla volta
  const toPlan = store.toSchedule();
  const unscheduledSec = toPlan.length ? `
    <div class="section" id="da-programmare">
      ${sectionHead(`Da programmare (${toPlan.length})`)}
      <p class="small muted" style="margin:-4px 2px 10px">Il prossimo intervento di ogni lavoro: tocca “Programma” e scegli il giorno guardando cosa c’è già.</p>
      <div class="card card-flush divided">
        ${toPlan.slice(0, wide ? 12 : 8).map(({ condo, work, job, left, lastDate }) => {
          const type = store.typeById(work.typeId);
          const num = store.jobNumber(job);
          const sug = store.suggestNext(job);
          return `
          <div class="plan-row">
            <span class="type-ic type-ic-sm" style="--c:${type.color}">${icon(type.icon)}</span>
            <span class="grow" style="min-width:0">
              <strong class="ellipsis" style="display:block">${esc(type.name)} · ${esc(condo.name)}</strong>
              <span class="small muted" style="display:block">${num ? `${num.n}° di ${num.of}` : ''}${left > 1 ? ` · ancora ${left} da programmare` : ''}${lastDate ? ` · ultimo in calendario ${esc(fmtShort(lastDate))}` : ' · niente in calendario'}</span>
              ${sug ? `<span class="small is-green" style="display:block">${icon('sparkles')} proposta: ${esc(fmtShort(sug))}</span>` : ''}
            </span>
            <button class="btn btn-primary btn-sm" data-action="schedule-job" data-id="${job.id}">${icon('calendar')}Programma</button>
          </div>`;
        }).join('')}
      </div>
      ${toPlan.length > (wide ? 12 : 8) ? `<p class="small muted" style="margin:8px 2px">E altri ${toPlan.length - (wide ? 12 : 8)} nelle schede dei condomini.</p>` : ''}
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

  // Agenda dei prossimi giorni: appuntamenti e lavori, giorno per giorno
  const weekAgendaSec = `
    <div class="section">
      ${sectionHead('I prossimi giorni', '<a class="link-btn" href="#/calendario">Calendario</a>')}
      <div class="card card-flush divided">
        ${Array.from({ length: 7 }, (_, i) => addDays(t, i)).map((iso) => {
          const dayJobs = store.jobsOn(iso);
          const dayEvents = store.eventsOn(iso);
          if (!dayJobs.length && !dayEvents.length) return '';
          const condi = [...new Set(dayJobs.map((j) => store.condoById(j.condoId)?.name).filter(Boolean))];
          return `
          <a class="agenda-row ${iso === t ? 'today' : ''}" href="#/calendario">
            <span class="agenda-day"><strong>${parseISO(iso).getDate()}</strong><small>${fmtShort(iso).split(' ')[0]}</small></span>
            <span class="grow">
              ${dayEvents.length ? `<span class="strong ellipsis">${dayEvents.map((ev) => esc(ev.title)).join(' · ')}</span>` : ''}
              <span class="small ${dayEvents.length ? 'muted' : 'strong'} ellipsis" style="display:block">${dayJobs.length ? `${plural(dayJobs.length, 'lavoro', 'lavori')}: ${condi.slice(0, 2).map(esc).join(', ')}${condi.length > 2 ? ` +${condi.length - 2}` : ''}` : 'Solo appuntamenti'}</span>
            </span>
            ${icon('right')}
          </a>`;
        }).join('') || '<div class="week-empty">Niente in programma nei prossimi 7 giorni.</div>'}
      </div>
    </div>`;

  // Solo il titolare: a colpo d'occhio come sta andando la giornata di ognuno
  const weekTo = addDays(weekFrom, 6);
  const crew = store.can('squadra')
    ? state.team.filter((m) => m.field).map((m) => ({ m, s: store.memberStats(m.id, weekFrom, weekTo) }))
    : [];
  // Registro dei lavori fatti: cosa hanno scritto i giardinieri (giorno, tempo, cosa hanno fatto)
  const doneLog = store.workLog({ from: addDays(t, -14), to: t }).slice(0, wide ? 10 : 6);
  const doneLogSec = `
    <div class="section" id="registro">
      ${sectionHead('Lavori fatti dalla squadra', '<a class="link-btn" href="#/registro">Registro completo</a>')}
      <p class="small muted" style="margin:-4px 2px 10px">Quello che i giardinieri registrano quando toccano “Fatto · registra” (ultimi 14 giorni).</p>
      ${doneLog.length ? `
      <div class="card card-flush divided">
        ${doneLog.map((x) => {
          const who = store.memberById(x.by);
          const names = x.team.map((id) => store.memberById(id)?.name).filter(Boolean);
          return `
          <button class="activity-row" data-action="${x.kind === 'job' ? 'open-job' : 'open-event'}" data-id="${x.id}">
            ${who ? avatar(who, 'sm') : '<span class="avatar avatar-sm" style="--c:#B5BDB6">?</span>'}
            <span class="grow" style="min-width:0">
              <span class="activity-text"><b>${esc(x.title)}</b>${x.where ? ` · ${esc(x.where)}` : ''}</span>
              <span class="small" style="display:block">${x.note ? `“${esc(x.note)}”` : '<span class="is-amber">Non ha scritto cosa ha fatto</span>'}</span>
              <span class="small muted" style="display:block">${esc(x.date ? fmtShort(x.date) : '')} · ${x.minutes ? esc(fmtDuration(x.minutes)) : 'tempo non indicato'} · ${esc(names.join(', ') || who?.name || '')}</span>
            </span>
          </button>`;
        }).join('')}
      </div>` : '<div class="week-empty">Ancora nessun lavoro registrato negli ultimi 14 giorni.</div>'}
    </div>`;
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

  const html = amministra
    ? (wide
      ? `
      <div class="home-head">${hello}${actions}</div>
      ${kpisAmm}
      <div class="cols">
        <div class="cols-main">${summaryCard()}${paySec}${checksSec}${deadlinesSec}</div>
        <aside class="cols-side">${eventsSec}${weekAgendaSec}${remainingSec}</aside>
      </div>`
      : `${hello}${kpisAmm}${actions}${summaryCard()}${paySec}${checksSec}${deadlinesSec}${eventsSec}${weekAgendaSec}${remainingSec}`)
    : (wide
      ? `
      <div class="home-head">${hello}${actions}</div>
      ${kpis}
      <div class="cols">
        <div class="cols-main">${summaryCard()}${unscheduledSec}${overdueSec}${doneLogSec}${remainingSec}${deadlinesSec}</div>
        <aside class="cols-side">${eventsSec}${crewSec}${todaySec}${seasonSec}</aside>
      </div>`
      : `${hello}${kpis}${summaryCard()}${actions}${unscheduledSec}${overdueSec}${doneLogSec}${eventsSec}${crewSec}${remainingSec}${deadlinesSec}${seasonSec}`);

  return {
    title: 'Home',
    html,
    mount(root) {
      if (amministra) bindPaymentClicks(root);
      root.addEventListener('click', (e) => {
        const sc = e.target.closest('[data-scroll]');
        if (sc) document.getElementById(sc.dataset.scroll)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (e.target.closest('[data-toggle-overdue]')) { showAllOverdue = !showAllOverdue; rerender(); }
        if (e.target.closest('[data-add-job]')) openAddJobSheet();
        if (e.target.closest('[data-new-event]')) openEventForm({ date: todayISO() });
        if (e.target.closest('[data-new-payment]')) openPaymentForm();
        if (e.target.closest('a.disabled')) e.preventDefault();
      });
    },
  };
}
