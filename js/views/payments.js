// "Pagamenti" (titolare e amministrazione): rate dei clienti, incassi, solleciti e contatti.
import * as store from '../store.js';
import { icon } from '../icons.js';
import { openSheet, toast, confirmDialog, rerender, isWide } from '../ui.js';
import { sectionHead, emptyState } from '../components.js';
import { PAYMENT_REPEATS, PAYMENT_METHODS } from '../data.js';
import { esc, todayISO, fmtEuro, fmtDateNum, relDay, diffDays, plural } from '../utils.js';

const DB_UPDATE_MSG = 'Per usare i pagamenti va aggiornato il database: riesegui schema.sql su Supabase (vedi guida).';
let tab = 'aperti';
let query = '';

const STATUS = {
  pagato: { label: 'Pagato', cls: 'chip-green', icon: 'check' },
  scaduto: { label: 'Scaduto', cls: 'chip-red', icon: 'alert' },
  'in-scadenza': { label: 'In scadenza', cls: 'chip-amber', icon: 'clock' },
  'da-pagare': { label: 'Da incassare', cls: '', icon: 'clock' },
};

// ---------- Contatti ----------

/** Numero per WhatsApp: solo cifre, con il prefisso italiano se manca */
function waNumber(phone) {
  let n = String(phone || '').replace(/[^\d+]/g, '');
  if (n.startsWith('+')) return n.slice(1);
  if (n.startsWith('00')) return n.slice(2);
  if (n.length >= 9 && n.length <= 10) return `39${n}`;
  return n;
}
const telHref = (phone) => `tel:${String(phone || '').replace(/[^\d+]/g, '')}`;

function reminderText(condo, items) {
  const tot = items.reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const list = items.map((p) => `- ${p.title}${p.dueDate ? ` (scadenza ${fmtDateNum(p.dueDate)})` : ''}: ${fmtEuro(p.amount)}`).join('\n');
  return `Buongiorno${condo.adminName ? ` ${condo.adminName}` : ''},\nle ricordiamo il pagamento per ${condo.name}:\n${list}\nTotale: ${fmtEuro(tot)}.\nSe ha già provveduto, non consideri questo messaggio.\nGrazie, FT Giardini`;
}

/** Pulsanti Chiama / WhatsApp / Email del cliente (amministratore del condominio) */
export function contactButtons(condo, { remind = [] } = {}) {
  if (!condo) return '';
  const text = remind.length ? reminderText(condo, remind) : '';
  const wa = condo.phone ? `https://wa.me/${waNumber(condo.phone)}${text ? `?text=${encodeURIComponent(text)}` : ''}` : '';
  const mail = condo.email ? `mailto:${esc(condo.email)}${text ? `?subject=${encodeURIComponent(`Promemoria pagamento ${condo.name}`)}&body=${encodeURIComponent(text)}` : ''}` : '';
  return `
    <div class="contact-btns">
      <a class="btn btn-soft btn-sm ${condo.phone ? '' : 'disabled'}" ${condo.phone ? `href="${telHref(condo.phone)}"` : 'aria-disabled="true"'}>${icon('phone')}Chiama</a>
      <a class="btn btn-whatsapp btn-sm ${condo.phone ? '' : 'disabled'}" ${wa ? `href="${wa}" target="_blank" rel="noopener"` : 'aria-disabled="true"'}>${icon('share')}${remind.length ? 'Sollecita' : 'WhatsApp'}</a>
      <a class="btn btn-ghost btn-sm ${condo.email ? '' : 'disabled'}" ${mail ? `href="${mail}"` : 'aria-disabled="true"'}>${icon('mail')}Email</a>
    </div>`;
}

// ---------- Righe ----------

export function paymentRow(p, { showCondo = true } = {}) {
  const st = store.paymentStatus(p);
  const s = STATUS[st];
  const condo = store.condoById(p.condoId);
  const late = st === 'scaduto' ? diffDays(p.dueDate, todayISO()) : 0;
  return `
    <div class="pay-row is-${st}">
      <button class="pay-main" data-pay="${p.id}">
        <span class="pay-text">
          ${showCondo ? `<strong class="ellipsis">${esc(condo?.name || 'Condominio eliminato')}</strong>` : ''}
          <span class="${showCondo ? 'small muted' : 'strong'} ellipsis">${esc(p.title || 'Pagamento')}</span>
          <span class="pay-meta">
            <span class="chip ${s.cls}">${icon(s.icon)}${st === 'pagato' ? `Pagato ${p.paidDate ? fmtDateNum(p.paidDate) : ''}` : st === 'scaduto' ? `Scaduto da ${plural(late, 'giorno', 'giorni')}` : p.dueDate ? `Scade ${relDay(p.dueDate).toLowerCase()}` : 'Senza scadenza'}</span>
            ${p.method && p.paid ? `<span class="chip">${esc(p.method)}</span>` : ''}
            ${p.note ? `<span class="chip">${icon('note')}Nota</span>` : ''}
          </span>
        </span>
        <span class="pay-amount">${fmtEuro(p.amount)}</span>
      </button>
      <button class="check ${p.paid ? 'checked' : ''}" data-pay-toggle="${p.id}" aria-label="${p.paid ? 'Segna da incassare' : 'Segna pagato'}">${icon('check')}</button>
    </div>`;
}

/** Riepilogo pagamenti di un condominio (per la sua scheda) */
export function condoPaymentsSection(condo) {
  if (!store.can('pagamenti')) return '';
  const list = store.paymentsOfCondo(condo.id);
  const tot = store.paymentTotals(condo.id);
  const late = list.filter((p) => store.paymentStatus(p) === 'scaduto');
  return `
    <div class="section">
      ${sectionHead('Pagamenti', `<button class="link-btn" data-add-payment="${condo.id}">${icon('plus')}Aggiungi</button>`)}
      <div class="card">
        <div class="pay-sum">
          <div><small>Da incassare</small><strong>${fmtEuro(tot.open)}</strong></div>
          <div class="${tot.lateCount ? 'is-red' : ''}"><small>Scaduto</small><strong>${fmtEuro(tot.late)}</strong></div>
          <div><small>Incassato</small><strong>${fmtEuro(tot.paid)}</strong></div>
        </div>
        ${contactButtons(condo, { remind: late })}
      </div>
      ${list.length ? `<div class="card card-flush divided" style="margin-top:10px">${list.map((p) => paymentRow(p, { showCondo: false })).join('')}</div>`
        : `<div class="week-empty">Nessuna rata inserita. <button class="link-btn" data-add-payment="${condo.id}">${icon('plus')}Aggiungi</button></div>`}
    </div>`;
}

/** Gestione dei click sulle righe dei pagamenti (da usare in ogni schermata che le mostra) */
export function bindPaymentClicks(root) {
  root.addEventListener('click', (e) => {
    const open = e.target.closest('[data-pay]');
    if (open) { openPaymentSheet(open.dataset.pay); return; }
    const tg = e.target.closest('[data-pay-toggle]');
    if (tg) {
      const p = store.paymentById(tg.dataset.payToggle);
      if (!p) return;
      if (p.paid) {
        store.setPaid(p.id, false);
        toast('Segnato di nuovo da incassare');
      } else {
        openPaidSheet(p.id);
      }
      return;
    }
    const add = e.target.closest('[data-add-payment]');
    if (add) openPaymentForm({ condoId: add.dataset.addPayment });
  });
}

// ---------- Schermata ----------

export function render() {
  if (!store.can('pagamenti')) {
    return { title: 'Pagamenti', html: `<div class="card">${emptyState('lock', 'Accesso riservato', 'I pagamenti li vedono solo Nicolas e Alessandro.')}</div>` };
  }
  const wide = isWide();
  const tot = store.paymentTotals();
  const available = store.paymentsAvailable();
  const q = query.trim().toLowerCase();

  const kpis = `
    <div class="kpis">
      <button class="kpi kpi-hero" data-tab="aperti" style="text-align:left">
        <span class="kpi-ic">${icon('file')}</span>
        <span class="kpi-num kpi-money">${fmtEuro(tot.open)}</span>
        <span class="kpi-label">Da incassare</span>
        <span class="kpi-sub">${plural(tot.openCount, 'rata', 'rate')}</span>
      </button>
      <button class="kpi ${tot.lateCount ? 'kpi-red' : ''}" data-tab="scaduti" style="text-align:left">
        <span class="kpi-ic">${icon('alert')}</span>
        <span class="kpi-num kpi-money">${fmtEuro(tot.late)}</span>
        <span class="kpi-label">Scaduti</span>
        <span class="kpi-sub">${plural(tot.lateCount, 'rata da sollecitare', 'rate da sollecitare')}</span>
      </button>
      <div class="kpi ${tot.soonCount ? 'kpi-amber' : ''}">
        <span class="kpi-ic">${icon('clock')}</span>
        <span class="kpi-num kpi-money">${fmtEuro(tot.soon)}</span>
        <span class="kpi-label">In scadenza</span>
        <span class="kpi-sub">prossimi 15 giorni</span>
      </div>
      <button class="kpi" data-tab="pagati" style="text-align:left">
        <span class="kpi-ic">${icon('check')}</span>
        <span class="kpi-num kpi-money">${fmtEuro(tot.paidYear)}</span>
        <span class="kpi-label">Incassato ${todayISO().slice(0, 4)}</span>
        <span class="kpi-sub">${plural(tot.paidYearCount, 'pagamento', 'pagamenti')}</span>
      </button>
    </div>`;

  const tabs = `
    <div class="seg seg-wide" style="margin:16px 0 12px">
      ${[['aperti', 'Da incassare'], ['scaduti', 'Scaduti'], ['pagati', 'Pagati'], ['clienti', 'Clienti']].map(([id, l]) => `<button class="${tab === id ? 'on' : ''}" data-tab="${id}">${l}</button>`).join('')}
    </div>
    <div class="toolbar">
      <label class="search">${icon('search')}<input class="input" type="search" placeholder="Cerca condominio o amministratore" value="${esc(query)}" data-search></label>
      <button class="btn btn-primary" data-new>${icon('plus')}Nuova rata</button>
    </div>`;

  let body;
  if (tab === 'clienti') {
    const condos = [...store.getState().condos].sort((a, b) => a.name.localeCompare(b.name));
    body = condos.length ? `<div class="client-grid">${condos.map((c) => {
      const t = store.paymentTotals(c.id);
      const late = store.paymentsOfCondo(c.id).filter((p) => store.paymentStatus(p) === 'scaduto');
      const hay = `${c.name} ${c.adminName} ${c.city}`.toLowerCase();
      return `
      <div class="card client-card" data-name="${esc(hay)}" ${q && !hay.includes(q) ? 'hidden' : ''}>
        <a class="row" href="#/condomini/${c.id}">
          <span class="condo-ic">${icon('building')}</span>
          <span class="grow" style="min-width:0">
            <strong class="strong ellipsis" style="display:block">${esc(c.name)}</strong>
            <span class="small muted ellipsis" style="display:block">${esc(c.adminName || 'Amministratore non inserito')}</span>
          </span>
          ${t.lateCount ? `<span class="chip chip-red">${icon('alert')}${fmtEuro(t.late)}</span>` : t.openCount ? `<span class="chip">${fmtEuro(t.open)}</span>` : '<span class="chip chip-green">In regola</span>'}
        </a>
        <div class="small muted" style="margin:8px 0 2px">${[c.phone, c.email].filter(Boolean).map(esc).join(' · ') || 'Nessun contatto: aggiungilo in Modifica condominio'}</div>
        ${contactButtons(c, { remind: late })}
      </div>`;
    }).join('')}</div>` : `<div class="card">${emptyState('building', 'Nessun cliente', 'I clienti sono i condomini inseriti.')}</div>`;
  } else {
    const list = store.paymentsList(tab).filter((p) => {
      if (!q) return true;
      const c = store.condoById(p.condoId);
      return `${c?.name} ${c?.adminName} ${p.title}`.toLowerCase().includes(q);
    });
    // i solleciti: raggruppati per cliente in cima alla lista degli scaduti
    const calls = tab === 'scaduti' ? store.clientsToCall() : [];
    body = `
      ${calls.length ? `
        <div class="section" style="margin-top:4px">
          ${sectionHead('Da sollecitare')}
          <div class="client-grid">${calls.map((x) => `
            <div class="card client-card">
              <div class="row">
                <span class="grow" style="min-width:0"><strong class="strong ellipsis" style="display:block">${esc(x.condo.name)}</strong>
                <span class="small muted">${esc(x.condo.adminName || '')} · ${plural(x.count, 'rata', 'rate')} · dal ${fmtDateNum(x.oldest)}</span></span>
                <strong class="is-red-text">${fmtEuro(x.amount)}</strong>
              </div>
              ${contactButtons(x.condo, { remind: store.paymentsOfCondo(x.condo.id).filter((p) => store.paymentStatus(p) === 'scaduto') })}
            </div>`).join('')}</div>
        </div>` : ''}
      ${list.length
        ? `<div class="card card-flush divided">${list.map((p) => paymentRow(p)).join('')}</div>`
        : `<div class="card">${emptyState(tab === 'scaduti' ? 'check' : 'file', tab === 'scaduti' ? 'Nessun pagamento scaduto' : tab === 'pagati' ? 'Nessun pagamento registrato' : 'Nessuna rata da incassare', tab === 'aperti' ? 'Tocca “Nuova rata” per inserire quanto deve pagare un condominio e quando.' : '')}</div>`}`;
  }

  const html = `
    <div class="page-head"><h1>Pagamenti</h1><p>Rate dei clienti, incassi e solleciti</p></div>
    ${!available ? `<div class="plan-warn">${icon('alert')}<span>${DB_UPDATE_MSG}</span></div>` : ''}
    ${kpis}
    ${tabs}
    ${body}
    <a class="fab" href="#" data-new aria-label="Nuova rata">${icon('plus')}</a>`;

  return {
    title: 'Pagamenti',
    html,
    mount(root) {
      bindPaymentClicks(root);
      root.addEventListener('click', (e) => {
        const t = e.target.closest('[data-tab]');
        if (t) { tab = t.dataset.tab; rerender(); }
        if (e.target.closest('[data-new]')) { e.preventDefault(); openPaymentForm(); }
        if (e.target.closest('a.disabled')) e.preventDefault();
      });
      const input = root.querySelector('[data-search]');
      input.addEventListener('input', () => {
        query = input.value;
        if (tab === 'clienti') {
          const v = query.trim().toLowerCase();
          root.querySelectorAll('[data-name]').forEach((el) => { el.hidden = !!v && !el.dataset.name.includes(v); });
        } else {
          clearTimeout(input._t);
          input._t = setTimeout(() => { rerender(); setTimeout(() => { const i = document.querySelector('[data-search]'); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }, 0); }, 350);
        }
      });
    },
  };
}

// ---------- Moduli ----------

/** Nuova rata / modifica */
export function openPaymentForm({ id = null, condoId = '' } = {}) {
  if (!store.can('pagamenti')) return;
  if (!store.paymentsAvailable()) { toast(DB_UPDATE_MSG, { duration: 8000 }); return; }
  const condos = [...store.getState().condos].sort((a, b) => a.name.localeCompare(b.name));
  if (!condos.length) { toast('Aggiungi prima un condominio'); return; }
  const p = id ? store.paymentById(id) : null;
  let repeat = 0;

  const s = openSheet({
    title: p ? 'Modifica pagamento' : 'Nuova rata',
    subtitle: p ? '' : 'Quanto deve pagare il cliente e quando',
    body: `
      <div class="field"><label for="pf-condo">Condominio</label>
        <select id="pf-condo" class="select" ${p ? 'disabled' : ''}>${condos.map((c) => `<option value="${c.id}" ${c.id === (p?.condoId || condoId) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="pf-title">Descrizione</label>
        <input id="pf-title" class="input" value="${esc(p?.title || '')}" placeholder="Es. Canone manutenzione verde, Fattura 12/2026" autocomplete="off"></div>
      <div class="field-row">
        <div class="field"><label for="pf-amount">Importo (€)</label>
          <input id="pf-amount" class="input" type="number" inputmode="decimal" min="0" step="0.01" value="${p ? p.amount : ''}" placeholder="0,00"></div>
        <div class="field"><label for="pf-due">${p ? 'Scadenza' : 'Prima scadenza'}</label>
          <input id="pf-due" class="input" type="date" value="${esc(p?.dueDate || todayISO())}"></div>
      </div>
      ${p ? '' : `
      <div class="field"><span class="label">Si ripete?</span>
        <div class="pick" data-repeat>${PAYMENT_REPEATS.map(([n, l]) => `<button class="${n === repeat ? 'on' : ''}" data-rep="${n}">${l}</button>`).join('')}</div>
      </div>
      <div class="field" data-count-wrap hidden><label for="pf-count">Quante rate</label>
        <input id="pf-count" class="input" type="number" inputmode="numeric" min="2" max="36" value="12" style="max-width:120px">
        <p class="hint">Ogni rata ha lo stesso importo. Es. canone annuale diviso in 12 rate mensili.</p></div>`}
      <div class="field"><label for="pf-note">Note</label>
        <textarea id="pf-note" class="textarea" rows="2" placeholder="Es. numero fattura, accordi con l'amministratore">${esc(p?.note || '')}</textarea></div>
      ${p ? `<button class="link-btn" style="color:var(--red);margin-top:12px" data-del>${icon('trash')}Elimina questo pagamento</button>` : ''}`,
    footer: `<button class="btn btn-ghost" data-close>Annulla</button><button class="btn btn-primary" data-ok>${icon('check')}Salva</button>`,
  });
  const $ = (q) => s.el.querySelector(q);

  s.el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.rep !== undefined) {
      repeat = Number(b.dataset.rep);
      s.el.querySelectorAll('[data-rep]').forEach((x) => x.classList.toggle('on', x === b));
      $('[data-count-wrap]').hidden = !repeat;
    }
    if ('del' in b.dataset && await confirmDialog({ title: 'Eliminare il pagamento?', message: `“${esc(p.title)}” di ${fmtEuro(p.amount)} verrà tolto.`, confirmText: 'Elimina', danger: true })) {
      store.deletePayment(p.id);
      s.close();
      toast('Pagamento eliminato');
    }
    if ('ok' in b.dataset) {
      const title = $('#pf-title').value.trim();
      const amount = Number(String($('#pf-amount').value).replace(',', '.'));
      const dueDate = $('#pf-due').value || null;
      const note = $('#pf-note').value;
      if (!title) { toast('Scrivi la descrizione'); $('#pf-title').focus(); return; }
      if (!(amount > 0)) { toast('Scrivi l’importo'); $('#pf-amount').focus(); return; }
      if (p) {
        store.updatePayment(p.id, { title, amount, dueDate, note });
        toast('Pagamento salvato');
      } else {
        const count = repeat ? Number($('#pf-count').value) || 1 : 1;
        const made = store.addPayments({ condoId: $('#pf-condo').value, title, amount, dueDate, repeat, count, note });
        toast(made.length > 1 ? `${made.length} rate inserite da ${fmtEuro(amount)}` : `Rata inserita: ${fmtEuro(amount)}`);
      }
      s.close();
    }
  });
  setTimeout(() => (p ? null : $('#pf-title'))?.focus(), 250);
}

/** Segna come pagato: data dell'incasso e modo */
export function openPaidSheet(id) {
  const p = store.paymentById(id);
  if (!p) return;
  const condo = store.condoById(p.condoId);
  let method = p.method || 'Bonifico';
  const s = openSheet({
    title: 'Pagamento ricevuto',
    subtitle: `${esc(condo?.name || '')} · ${esc(fmtEuro(p.amount))}`,
    body: `
      <div class="field"><label for="pd-date">Data dell'incasso</label>
        <input id="pd-date" class="input" type="date" value="${todayISO()}" max="${todayISO()}"></div>
      <div class="field"><span class="label">Come ha pagato</span>
        <div class="pick" style="margin-top:6px">${PAYMENT_METHODS.map((m) => `<button class="${m === method ? 'on' : ''}" data-method="${esc(m)}">${esc(m)}</button>`).join('')}</div></div>`,
    footer: `<button class="btn btn-ghost" data-close>Annulla</button><button class="btn btn-primary" data-ok>${icon('check')}Segna pagato</button>`,
  });
  s.el.addEventListener('click', (e) => {
    const m = e.target.closest('[data-method]');
    if (m) { method = m.dataset.method; s.el.querySelectorAll('[data-method]').forEach((x) => x.classList.toggle('on', x === m)); }
    if (e.target.closest('[data-ok]')) {
      store.setPaid(id, true, { date: s.el.querySelector('#pd-date').value || todayISO(), method });
      s.close();
      toast(`Incassato ${fmtEuro(p.amount)}`, { actionText: 'Annulla', onAction: () => store.setPaid(id, false) });
    }
  });
}

/** Dettaglio di una rata */
export function openPaymentSheet(id) {
  const p = store.paymentById(id);
  if (!p) return;
  const condo = store.condoById(p.condoId);
  const st = store.paymentStatus(p);
  const who = store.memberById(p.paidBy);
  const late = st === 'scaduto' ? [p] : [];
  const s = openSheet({
    title: p.title || 'Pagamento',
    subtitle: esc(condo?.name || ''),
    body: `
      <div class="pay-big is-${st}"><strong>${fmtEuro(p.amount)}</strong><span class="chip ${STATUS[st].cls}">${icon(STATUS[st].icon)}${STATUS[st].label}</span></div>
      <div class="card card-flush divided" style="margin-top:14px">
        <div class="info-row">${icon('calendar')}<div class="grow"><span class="label">Scadenza</span><span class="value">${p.dueDate ? `${fmtDateNum(p.dueDate)} · ${esc(relDay(p.dueDate))}` : 'Nessuna'}</span></div></div>
        ${p.paid ? `<div class="info-row">${icon('check')}<div class="grow"><span class="label">Incassato</span><span class="value">${fmtDateNum(p.paidDate)}${p.method ? ` · ${esc(p.method)}` : ''}${who ? ` · segnato da ${esc(who.name)}` : ''}</span></div></div>` : ''}
        ${condo ? `<div class="info-row">${icon('user')}<div class="grow"><span class="label">Cliente</span><span class="value">${esc(condo.adminName || '—')}</span><span class="small muted" style="display:block">${[condo.phone, condo.email].filter(Boolean).map(esc).join(' · ')}</span></div></div>` : ''}
        ${p.note ? `<div class="info-row">${icon('note')}<div class="grow"><span class="label">Note</span><span class="value" style="font-weight:500">${esc(p.note)}</span></div></div>` : ''}
      </div>
      ${condo ? `<div style="margin-top:12px">${contactButtons(condo, { remind: late })}</div>` : ''}`,
    footer: `
      <button class="btn btn-ghost" data-edit>${icon('edit')}Modifica</button>
      ${p.paid ? `<button class="btn btn-ghost" data-unpaid>${icon('x')}Non pagato</button>` : `<button class="btn btn-primary" data-paid>${icon('check')}Pagato</button>`}`,
  });
  s.el.addEventListener('click', (e) => {
    if (e.target.closest('a.disabled')) e.preventDefault();
    if (e.target.closest('[data-edit]')) { s.close(); setTimeout(() => openPaymentForm({ id }), 230); }
    if (e.target.closest('[data-paid]')) { s.close(); setTimeout(() => openPaidSheet(id), 230); }
    if (e.target.closest('[data-unpaid]')) { store.setPaid(id, false); s.close(); toast('Segnato di nuovo da incassare'); }
  });
}
