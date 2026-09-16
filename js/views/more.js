// "Altro": profilo e password, tipi di lavoro, giorni lavorativi e backup.
// Ogni sezione compare solo a chi ha il permesso (vedi ROLES in data.js).
import * as store from '../store.js';
import { icon, WORK_ICONS } from '../icons.js';
import { openSheet, toast, confirmDialog, rerender } from '../ui.js';
import { avatar, typeIcon, memberSub } from '../components.js';
import { WORK_COLORS, ROLES } from '../data.js';
import { esc, monthsLabel, MONTH_INITIALS, MONTHS_SHORT, WEEKDAYS_SHORT, todayISO } from '../utils.js';

export function render() {
  const user = store.currentUser();
  const state = store.getState();
  const role = ROLES[user.role];

  const html = `
    <div class="page-head"><h1>Altro</h1></div>

    <div class="card profile">
      ${avatar(user, 'lg')}
      <div class="grow">
        <h2>${esc(user.name)}</h2>
        <p class="small muted">${esc(memberSub(user))}</p>
        <span class="role-tag role-${user.role}" style="margin-top:6px">${esc(role.label)}</span>
      </div>
    </div>
    <div class="row" style="margin-top:10px">
      ${store.isCloud ? `<button class="btn btn-ghost grow" data-password>${icon('lock')}Cambia password</button>` : ''}
      <button class="btn btn-ghost grow" data-logout>${icon('logout')}${store.isCloud ? 'Esci' : 'Cambia persona'}</button>
    </div>

    <div class="masonry">

    ${store.can('gestione') ? `
    <div class="section">
      <a class="card card-flush menu-row" href="#/preventivi">
        <span class="row-ic">${icon('file')}</span>
        <span class="grow"><strong>Crea preventivo</strong><small>Compila cliente e servizi, scarica il PDF o invialo su WhatsApp</small></span>
        ${icon('right')}
      </a>
    </div>` : ''}

    ${store.can('gestione') ? `
    <div class="section">
      <a class="card card-flush menu-row" href="#/registro">
        <span class="row-ic">${icon('list')}</span>
        <span class="grow"><strong>Registro lavori</strong><small>Cosa ha fatto la squadra, in quanto tempo e con quali note</small></span>
        ${icon('right')}
      </a>
    </div>` : ''}

    ${store.can('pagamenti') ? `
    <div class="section">
      <a class="card card-flush menu-row" href="#/pagamenti">
        <span class="row-ic">${icon('file')}</span>
        <span class="grow"><strong>Pagamenti e clienti</strong><small>Rate da incassare, scaduti, solleciti e contatti</small></span>
        ${icon('right')}
      </a>
    </div>` : ''}

    ${store.can('squadra') ? `
    <div class="section">
      <a class="card card-flush menu-row" href="#/squadra">
        <span class="row-ic">${icon('users')}</span>
        <span class="grow"><strong>Squadra e accessi</strong><small>Persone, ruoli, password e attività</small></span>
        ${icon('right')}
      </a>
    </div>` : ''}

    ${store.can('impostazioni') ? `
    <div class="section">
      <div class="section-head"><h2>Tipi di lavoro</h2><button class="link-btn" data-type="">${icon('plus')}Aggiungi</button></div>
      <div class="card card-flush divided">
        ${state.workTypes.map((t) => `
          <button class="menu-row" data-type="${t.id}">
            ${typeIcon(t, 'sm')}
            <span class="grow"><strong>${esc(t.name)}</strong><small>Di solito: ${monthsLabel(t.months)}</small></span>
            ${icon('right')}
          </button>`).join('')}
      </div>
    </div>

    <div class="section">
      <div class="section-head"><h2>Giorni lavorativi</h2></div>
      <div class="card">
        <p class="small muted" style="margin-bottom:10px">La pianificazione automatica mette i lavori solo in questi giorni.</p>
        <div class="pick">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button class="${state.settings.workDays.includes(d) ? 'on' : ''}" data-wd="${d}">${WEEKDAYS_SHORT[d]}</button>`).join('')}</div>
      </div>
    </div>` : ''}

    ${store.can('backup') ? `
    <div class="section">
      <div class="section-head"><h2>Dati</h2></div>
      <div class="card card-flush divided">
        <button class="menu-row" data-export><span class="row-ic">${icon('download')}</span><span class="grow"><strong>Scarica backup</strong><small>Salva tutti i dati in un file</small></span></button>
        ${store.can('dati') ? `
        <label class="menu-row" style="cursor:pointer"><input type="file" accept="application/json,.json" hidden data-import><span class="row-ic">${icon('upload')}</span><span class="grow"><strong>Carica backup</strong><small>Sostituisce condomini e interventi con quelli del file</small></span></label>
        <button class="menu-row danger" data-clear><span class="row-ic">${icon('trash')}</span><span class="grow"><strong>Inizia da zero</strong><small>Cancella condomini, interventi, appuntamenti e pagamenti${store.isCloud ? ' per tutti' : ''} (resta la squadra)</small></span></button>` : ''}
      </div>
      <p class="small muted" style="margin:10px 4px 0">${store.isCloud
        ? 'Dati salvati online e condivisi con tutta la squadra. Consiglio: scarica un backup ogni settimana.'
        : 'Modalità prova: i dati sono salvati solo su questo dispositivo.'}</p>
    </div>` : ''}

    </div>

    <p class="version">FT Giardini · Lavori — bozza 0.1</p>
  `;

  return {
    title: 'Altro',
    html,
    mount(root) {
      root.addEventListener('click', async (e) => {
        const el = e.target.closest('button');
        if (!el) return;
        const ds = el.dataset;
        if ('logout' in ds) window.dispatchEvent(new CustomEvent('app:logout'));
        if ('password' in ds) openPasswordSheet();
        if ('type' in ds && store.can('impostazioni')) openTypeSheet(ds.type);
        if (ds.wd !== undefined && store.can('impostazioni')) {
          const d = Number(ds.wd);
          const days = store.getState().settings.workDays;
          const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
          if (!next.length) { toast('Serve almeno un giorno lavorativo'); return; }
          store.setWorkDays(next);
        }
        if ('export' in ds) exportBackup();
        if (!store.can('dati')) return;
        if ('clear' in ds && await confirmDialog({ title: 'Iniziare da zero?', message: `Verranno cancellati tutti i condomini, gli interventi, gli appuntamenti e i pagamenti${store.isCloud ? ', per tutta la squadra' : ''}. Consiglio: scarica prima un backup.`, confirmText: 'Cancella tutto', danger: true })) {
          store.clearAll();
          toast('Dati cancellati');
        }
      });
      root.querySelector('[data-import]')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        const ok = await confirmDialog({
          title: 'Caricare il backup?',
          message: `Condomini e interventi attuali verranno sostituiti da quelli del file${store.isCloud ? ', per tutta la squadra. Le persone vengono riconosciute per nome' : ''}.`,
          confirmText: 'Carica',
          danger: true,
        });
        if (!ok) return;
        try {
          store.importData(await file.text());
          toast('Backup caricato');
        } catch {
          toast('File di backup non valido');
        }
      });
    },
  };
}

function exportBackup() {
  const blob = new Blob([store.exportData()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ft-lavori-backup-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Ognuno può cambiare la propria password conoscendo quella attuale */
function openPasswordSheet() {
  const user = store.currentUser();
  const field = (id, label, auto) => `
    <div class="field"><label for="${id}">${label}</label>
      <input id="${id}" class="input" type="password" autocomplete="${auto}" autocapitalize="characters" autocorrect="off" spellcheck="false"></div>`;
  const s = openSheet({
    title: 'Cambia password',
    subtitle: esc(user.name),
    body: `
      <form data-pw-form autocomplete="on">
        <input type="text" name="username" value="${esc(user.name)}" autocomplete="username" hidden>
        ${field('pw-old', 'Password attuale', 'current-password')}
        ${field('pw-new', 'Nuova password', 'new-password')}
        ${field('pw-new2', 'Ripeti la nuova password', 'new-password')}
        <p class="hint" style="margin-top:8px">Almeno ${store.MIN_PASSWORD} caratteri. Maiuscole e minuscole sono indifferenti.</p>
      </form>`,
    footer: `<button class="btn btn-ghost" data-close>Annulla</button><button class="btn btn-primary" data-ok>Salva</button>`,
  });
  let busy = false;
  const save = async () => {
    if (busy) return;
    const old = s.el.querySelector('#pw-old').value;
    const pw = s.el.querySelector('#pw-new').value.trim();
    const pw2 = s.el.querySelector('#pw-new2').value.trim();
    if (pw.toUpperCase() !== pw2.toUpperCase()) { toast('Le due password non coincidono'); return; }
    busy = true;
    try {
      await store.changeOwnPassword(old, pw);
      s.close();
      toast('Password cambiata');
    } catch (err) {
      toast(err.message);
    } finally {
      busy = false;
    }
  };
  s.el.querySelector('[data-ok]').addEventListener('click', save);
  s.el.querySelector('[data-pw-form]').addEventListener('submit', (e) => { e.preventDefault(); save(); });
  setTimeout(() => s.el.querySelector('#pw-old')?.focus(), 80);
}

function openTypeSheet(id) {
  const t = id ? store.typeById(id) : { name: '', icon: 'tool', color: WORK_COLORS[6], months: [3, 4, 5, 6, 7, 8, 9, 10] };
  let { color, icon: ic } = t;
  const months = new Set(t.months);
  const s = openSheet({
    title: id ? 'Tipo di lavoro' : 'Nuovo tipo di lavoro',
    body: `
      <div class="field"><label for="tp-name">Nome</label><input id="tp-name" class="input" value="${esc(t.name)}" autocomplete="off"></div>
      <div class="field"><span class="label">Icona</span><div class="pick">${WORK_ICONS.map((n) => `<button data-icon="${n}" class="${n === ic ? 'on' : ''}" style="width:44px;padding:0;justify-content:center" aria-label="${n}">${icon(n)}</button>`).join('')}</div></div>
      <div class="field"><span class="label">Colore</span><div class="pick">${WORK_COLORS.map((c) => `<button data-color="${c}" class="${c === color ? 'on' : ''}" style="width:38px;padding:0;justify-content:center" aria-label="Colore"><span class="avatar avatar-xs" style="--c:${c}"></span></button>`).join('')}</div></div>
      <div class="field"><span class="label">Mesi proposti di solito</span><div class="months">${MONTH_INITIALS.map((l, m) => `<button class="${months.has(m + 1) ? 'on' : ''}" data-m="${m + 1}">${l}<small>${MONTHS_SHORT[m]}</small></button>`).join('')}</div>
      <p class="hint">Vale per i nuovi contratti; quelli esistenti non cambiano.</p></div>`,
    footer: `<button class="btn btn-ghost" data-close>Annulla</button><button class="btn btn-primary" data-ok>Salva</button>`,
  });
  s.el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.icon) { ic = b.dataset.icon; s.el.querySelectorAll('[data-icon]').forEach((x) => x.classList.toggle('on', x === b)); }
    if (b.dataset.color) { color = b.dataset.color; s.el.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === b)); }
    if (b.dataset.m) { const n = Number(b.dataset.m); months.has(n) ? months.delete(n) : months.add(n); b.classList.toggle('on'); }
    if ('ok' in b.dataset) {
      const name = s.el.querySelector('#tp-name').value.trim();
      if (!name) { toast('Scrivi il nome'); return; }
      store.saveWorkType({ ...(id ? { id } : {}), name, icon: ic, color, months: [...months].sort((a, b) => a - b) });
      s.close();
    }
  });
}
