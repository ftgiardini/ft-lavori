// Avvio dell'app: scelta utente, struttura (barra in alto + menu), navigazione tra le schermate.
import * as store from './store.js';
import { icon } from './icons.js';
import { avatar, memberSub } from './components.js';
import { toggleDone, openPostponeSheet, openJobSheet, openDoneSheet, openScheduleSheet } from './views/job-sheet.js';
import { openEventSheet, toggleEvent, openEventReport } from './views/event-sheet.js';
import * as home from './views/home.js';
import * as today from './views/today.js';
import * as calendar from './views/calendar.js';
import * as condos from './views/condos.js';
import { renderForm } from './views/condo-form.js';
import * as more from './views/more.js';
import * as team from './views/team.js';
import * as quotes from './views/quotes.js';
import * as payments from './views/payments.js';
import * as worklog from './views/worklog.js';
import { ROLES } from './data.js';
import { esc, currentSeasonRange, isIOS } from './utils.js';
import { wideMQ, toast, confirmDialog } from './ui.js';

const app = document.getElementById('app');
const INSTALL_KEY = 'ftg-lavori-install-nascosto';
let lastRoute = null;

function routeParts() {
  return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
}

function resolve(admin) {
  const [a, b, c] = routeParts();
  const start = () => (admin ? { tab: 'home', view: home.render() } : { tab: 'oggi', view: today.render() });
  switch (a) {
    case 'oggi': return { tab: 'oggi', view: today.render() };
    case 'calendario': return { tab: 'calendario', view: calendar.render() };
    case 'condomini':
      // la scheda di un condominio è visibile a tutti (indirizzo, note); il resto solo a chi gestisce
      if (b && b !== 'nuovo' && c !== 'modifica') return { tab: store.can('condomini') ? 'condomini' : 'oggi', view: condos.renderDetail(b) };
      if (!store.can('condomini')) return start();
      if (!b) return { tab: 'condomini', view: condos.renderList() };
      if (b === 'nuovo') return { tab: 'condomini', view: renderForm(null) };
      return { tab: 'condomini', view: renderForm(b) };
    case 'squadra': return store.can('squadra') ? { tab: 'squadra', view: team.render() } : start();
    case 'preventivi': return store.can('gestione') ? { tab: 'preventivi', view: quotes.render() } : start();
    case 'registro': return store.can('gestione') ? { tab: 'registro', view: worklog.render() } : start();
    case 'pagamenti': return store.can('pagamenti') ? { tab: 'pagamenti', view: payments.render() } : start();
    case 'altro': return { tab: 'altro', view: more.render() };
    default: return start();
  }
}

function installBanner(tab) {
  let hidden = false;
  try { hidden = localStorage.getItem(INSTALL_KEY) === '1'; } catch { /* niente */ }
  if (hidden || !isIOS() || navigator.standalone || !['home', 'oggi'].includes(tab)) return '';
  return `
    <div class="install-banner">
      <img src="icons/apple-touch-icon.png" alt="">
      <div class="grow"><strong>Metti l’app nella Home</strong>Tocca ${icon('share')} Condividi → “Aggiungi alla schermata Home”</div>
      <button class="icon-btn" data-hide-install aria-label="Nascondi">${icon('x')}</button>
    </div>`;
}

let loginPick = null; // persona scelta, in attesa della password

let loggingIn = false;

function renderLogin(error = '') {
  const team = store.loginTeam();
  const m = store.isCloud && loginPick ? team.find((x) => x.id === loginPick) : null;
  if (loginPick && !m) loginPick = null;
  app.innerHTML = `
    <div class="login">
      <div class="login-card">
        <img class="login-logo" src="img/logo.svg" alt="FT Giardini · Passione nel verde">
        ${m ? `
        <form class="login-pass" data-login-form autocomplete="on">
          <div class="login-who">
            ${avatar(m, 'lg')}
            <div><strong>${esc(m.name)}</strong><small>${esc(memberSub(m))}</small></div>
          </div>
          <input type="text" name="username" value="${esc(m.name)}" autocomplete="username" hidden>
          <div class="field">
            <label for="login-password">Password</label>
            <div class="pass-wrap">
              <input id="login-password" class="input ${error ? 'input-error' : ''}" type="password" name="password" autocomplete="current-password" autocapitalize="characters" autocorrect="off" spellcheck="false" required>
              <button type="button" class="icon-btn" data-toggle-pass aria-label="Mostra password">${icon('eye')}</button>
            </div>
            ${error ? `<p class="login-error">${icon('alert')}${esc(error)}</p>` : ''}
          </div>
          <button class="btn btn-primary btn-block" type="submit" ${loggingIn ? 'disabled' : ''}>${loggingIn ? 'Accesso in corso…' : 'Entra'}</button>
          <button class="btn btn-ghost btn-block" type="button" data-login-back>${icon('left')}Non sono ${esc(m.name)}</button>
        </form>` : `
        <h1>Chi sta usando l’app?</h1>
        <p class="lead">${store.isCloud ? 'Scegli il tuo nome e inserisci la tua password.' : 'Scegli il tuo nome per entrare.'}</p>
        <div class="login-list">
          ${team.map((x) => `
            <button class="login-user" data-login="${x.id}">
              ${avatar(x, 'lg')}
              <span><strong>${esc(x.name)}</strong><small>${esc(memberSub(x))}</small></span>
              ${icon('right')}
            </button>`).join('')}
          ${!team.length ? `<p class="login-error" style="justify-content:center">${icon('alert')}${navigator.onLine ? 'Elenco non disponibile: controlla la configurazione del database.' : 'Serve internet per il primo accesso.'}</p>
            <button class="btn btn-ghost btn-block" data-login-reload>Riprova</button>` : ''}
        </div>`}
        <p class="login-note">${store.isCloud
          ? 'Password dimenticata? Chiedi a Nicolas di impostarne una nuova.'
          : 'Versione senza database · i dati restano solo su questo dispositivo'}</p>
      </div>
    </div>`;
  if (m) setTimeout(() => document.getElementById('login-password')?.focus(), 60);
}

async function submitLogin(form) {
  const password = form.password.value;
  if (!password.trim() || loggingIn) return;
  loggingIn = true;
  renderLogin();
  try {
    const ok = await store.login(loginPick, password);
    loggingIn = false;
    if (ok) {
      loginPick = null;
      location.hash = '#/';
      render();
    } else {
      renderLogin('Password sbagliata, riprova.');
    }
  } catch (err) {
    loggingIn = false;
    renderLogin(err.message);
  }
}

function renderNoData() {
  app.innerHTML = `
    <div class="login">
      <div class="login-card">
        <img class="login-logo" src="img/logo.svg" alt="FT Giardini · Passione nel verde">
        <h1>Dati non disponibili</h1>
        <p class="lead">${navigator.onLine ? 'Non riesco a scaricare i dati dal database.' : 'Sei senza connessione. Al primo accesso serve internet per scaricare i dati.'}</p>
        <div class="login-list">
          <button class="btn btn-primary btn-block" data-refresh-data>Riprova</button>
          <button class="btn btn-ghost btn-block" data-logout-side>${icon('logout')}Esci</button>
        </div>
      </div>
    </div>`;
}

/** Pallino in alto quando il salvataggio online non è a posto */
function syncPill() {
  const { status, pending } = store.syncInfo();
  if (status === 'offline') return `<span class="sync-pill sync-offline" title="Le modifiche verranno salvate appena torna la connessione">${icon('clock')}Offline${pending ? ` · ${pending}` : ''}</span>`;
  if (status === 'error') return `<span class="sync-pill sync-error">${icon('alert')}Non salvato</span>`;
  if (status === 'saving' && pending > 3) return `<span class="sync-pill">${icon('upload')}Salvo…</span>`;
  return '';
}

function render() {
  deferredRender = false;
  if (store.needsData() || !store.currentUser()) document.body.classList.remove('is-fullscreen');
  if (store.needsData()) { renderNoData(); lastRoute = null; return; }
  const user = store.currentUser();
  if (!user) { renderLogin(); lastRoute = null; return; }

  const admin = store.isAdmin();
  const route = location.hash || '#/';
  const changedRoute = route !== lastRoute;
  if (changedRoute && lastRoute) scrollMemo.set(lastRoute, window.scrollY);
  // come nelle app: tornando su una schermata principale si ritrova il punto dove si era
  const scroll = !changedRoute ? window.scrollY : ROOT_ROUTES.test(route) ? scrollMemo.get(route) || 0 : 0;
  const { tab, view } = resolve(admin);
  const fullscreen = /\/(nuovo|modifica)$/.test(route);
  document.body.classList.toggle('is-fullscreen', fullscreen);
  // titolo grande nella pagina: il titolo piccolo in alto compare solo scorrendo
  const bigTitle = /class="(page-head|detail-head|hello|wiz-head)[ "]/.test(view.html);
  const season = currentSeasonRange().season;
  const overdue = store.overdueJobs(admin || !user.field ? null : user.id).length;

  // Menu diverso per ruolo: giardinieri solo l'essenziale, ufficio la gestione, titolare anche la squadra
  // Alessandro (amministrazione) non va in cantiere ogni giorno: al posto di Oggi ha i Pagamenti
  const accounting = ROLES[user.role]?.home === 'scadenze';
  const latePay = store.can('pagamenti') ? store.paymentTotals().lateCount : 0;
  const tabs = [
    admin && ['home', 'Home', 'home', accounting ? 0 : overdue],
    accounting ? ['pagamenti', 'Pagamenti', 'file', latePay] : ['oggi', 'Oggi', 'today', admin ? 0 : overdue],
    ['calendario', 'Calendario', 'calendar', 0],
    store.can('condomini') && ['condomini', 'Condomini', 'building', 0],
    // sul telefono "Squadra" sta in Altro, così il menu in basso resta leggibile
    store.can('gestione') && ['registro', 'Registro lavori', 'list', 0, 'desktop-tab'],
    store.can('squadra') && ['squadra', 'Squadra', 'users', 0, 'desktop-tab'],
    !accounting && store.can('pagamenti') && ['pagamenti', 'Pagamenti', 'file', latePay, 'desktop-tab'],
    store.can('gestione') && ['preventivi', 'Crea preventivo', 'edit', 0, '', 'Preventivo'],
    ['altro', 'Altro', 'more', 0],
  ].filter(Boolean);

  app.innerHTML = `
    <div class="shell">
      <header class="topbar ${bigTitle ? '' : 'show-title'}">
        ${view.back
          ? `<button class="topbar-back" data-topbar-back="${esc(view.back)}" aria-label="Indietro">${icon('left')}<span>${esc(view.backLabel || 'Indietro')}</span></button>`
          : '<img class="topbar-mark" src="img/logo-mark.svg" alt="FT Giardini">'}
        <button class="topbar-title" data-scroll-top>${esc(view.title)}</button>
        ${syncPill() || `<span class="season-pill" style="--c:${season.color}" title="Stagione in corso">${icon(season.icon)}${season.name}</span>`}
        <a href="#/altro" aria-label="Profilo di ${esc(user.name)}">${avatar(user, 'md')}</a>
      </header>
      <nav class="tabbar" aria-label="Menu principale">
        <a class="sidebar-brand" href="#/"><img src="img/logo.svg" alt="FT Giardini"></a>
        ${tabs.map(([id, label, ic, badge, cls = '', short = '']) => `
          <a class="tab ${cls} ${tab === id ? 'active' : ''}" href="#/${id}" ${tab === id ? 'aria-current="page"' : ''}>
            ${icon(ic)}${short ? `<span class="lbl-long">${label}</span><span class="lbl-short">${short}</span>` : `<span>${label}</span>`}${badge ? `<span class="badge">${badge}</span>` : ''}
          </a>`).join('')}
        <div class="sidebar-user row">
          ${avatar(user, 'md')}
          <div class="grow"><strong class="strong">${esc(user.name)}</strong><div class="small muted ellipsis">${esc(ROLES[user.role]?.label || '')}</div></div>
          <button class="icon-btn" data-logout-side aria-label="Esci" title="Esci">${icon('logout')}</button>
        </div>
      </nav>
      <main class="main" id="main">${installBanner(tab)}</main>
    </div>`;

  const container = document.createElement('div');
  if (changedRoute) container.className = 'view-enter';
  container.innerHTML = view.html;
  document.getElementById('main').appendChild(container);
  view.mount?.(container);
  if (!isTyping(document.activeElement)) document.body.classList.remove('kbd');
  ignoreScrollUntil = Date.now() + 250;
  window.scrollTo(0, scroll);
  lastRoute = route;
  watchBigTitle(container);
}

// lo scorrimento lo gestisce l'app (come nelle app vere), non il browser
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
const ROOT_ROUTES = /^#\/(oggi|calendario|condomini|squadra|preventivi|pagamenti|registro|altro)?$/;
const scrollMemo = new Map();
let ignoreScrollUntil = 0;
window.addEventListener('scroll', () => {
  if (lastRoute && Date.now() > ignoreScrollUntil) scrollMemo.set(lastRoute, window.scrollY);
}, { passive: true });

// Titolo grande: quando esce sotto la barra in alto, il titolo piccolo compare nella barra
let bigTitleEl = null;
function updateTopbarTitle() {
  const topbar = document.querySelector('.topbar');
  if (!topbar) return;
  if (!bigTitleEl?.isConnected) { topbar.classList.add('show-title'); return; }
  const limit = topbar.getBoundingClientRect().bottom;
  topbar.classList.toggle('show-title', bigTitleEl.getBoundingClientRect().bottom <= limit);
}
function watchBigTitle(container) {
  bigTitleEl = container.querySelector('.page-head h1, .detail-head h1, .hello h1, .wiz-head h1');
  updateTopbarTitle();
}
window.addEventListener('scroll', updateTopbarTitle, { passive: true });
window.addEventListener('resize', updateTopbarTitle, { passive: true });

// Azioni comuni a tutte le schermate
document.addEventListener('click', (e) => {
  const login = e.target.closest('[data-login]');
  if (login) {
    if (store.isCloud) {
      loginPick = login.dataset.login;
      renderLogin();
    } else {
      store.login(login.dataset.login).then(() => { location.hash = '#/'; render(); });
    }
    return;
  }
  if (e.target.closest('[data-logout-side]')) {
    logoutWithCheck();
    return;
  }
  if (e.target.closest('[data-login-reload]')) {
    store.refreshLoginList().then(() => renderLogin());
    return;
  }
  if (e.target.closest('[data-refresh-data]')) {
    store.refresh().then(render);
    return;
  }
  if (e.target.closest('[data-login-back]')) {
    loginPick = null;
    renderLogin();
    return;
  }
  const toggle = e.target.closest('[data-toggle-pass]');
  if (toggle) {
    const input = toggle.parentElement.querySelector('input');
    input.type = input.type === 'password' ? 'text' : 'password';
    input.focus();
    return;
  }
  const back = e.target.closest('[data-topbar-back]');
  if (back) {
    const target = back.dataset.topbarBack;
    if (target === 'history') {
      if (history.length > 1) history.back();
      else location.hash = '#/';
    } else {
      location.hash = target;
    }
    return;
  }
  if (e.target.closest('[data-scroll-top]')) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  if (e.target.closest('[data-hide-install]')) {
    try { localStorage.setItem(INSTALL_KEY, '1'); } catch { /* niente */ }
    render();
    return;
  }
  const act = e.target.closest('[data-action]');
  if (!act) return;
  const { action, id } = act.dataset;
  if (action === 'toggle-done') {
    toggleDone(id);
    document.querySelectorAll(`.check[data-id="${id}"]`).forEach((b) => b.classList.add('pop'));
  }
  if (action === 'postpone') openPostponeSheet(id);
  if (action === 'register-done') openDoneSheet(id);
  if (action === 'schedule-job') openScheduleSheet(id);
  if (action === 'report-event') openEventReport(id);
  if (action === 'open-job') openJobSheet(id);
  if (action === 'open-event') openEventSheet(id);
  if (action === 'toggle-event') {
    toggleEvent(id);
    document.querySelectorAll(`.check[data-id="${id}"]`).forEach((b) => b.classList.add('pop'));
  }
});

document.addEventListener('submit', (e) => {
  if (!e.target.matches('[data-login-form]')) return;
  e.preventDefault();
  submitLogin(e.target);
});

/** Esce; se ci sono modifiche non ancora salvate online chiede conferma */
async function logoutWithCheck() {
  const { pending } = store.syncInfo();
  if (pending && !(await confirmDialog({
    title: 'Modifiche non ancora salvate',
    message: `Ci sono ${pending} modifiche che non sono ancora arrivate online (manca la connessione). Se esci adesso andranno perse.`,
    confirmText: 'Esci comunque',
    danger: true,
  }))) return;
  await store.logout();
  location.hash = '#/';
  render();
}
window.addEventListener('app:logout', logoutWithCheck);

window.addEventListener('hashchange', render);
window.addEventListener('app:render', render);
// Passando da telefono a computer (o ridimensionando la finestra) cambia la disposizione
wideMQ.addEventListener('change', render);

// Sul telefono, mentre si scrive, nasconde il menu in basso così la tastiera non copre i campi
const isTyping = (el) => el?.matches?.('input:not([type=checkbox]):not([type=file]):not([type=date]), textarea, select');
document.addEventListener('focusin', (e) => { if (isTyping(e.target)) document.body.classList.add('kbd'); });
document.addEventListener('focusout', () => setTimeout(() => {
  if (isTyping(document.activeElement)) return;
  document.body.classList.remove('kbd');
  if (deferredRender && !isBusy()) render();
}, 50));

if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) document.documentElement.classList.add('standalone');

// Le modifiche che arrivano dagli altri non ridisegnano la schermata mentre si sta scrivendo
// o compilando un modulo (si perderebbe il testo): aspettano che si finisca.
let deferredRender = false;
const isBusy = () => isTyping(document.activeElement) || /\/(nuovo|modifica)$/.test(location.hash);

store.onMessage((msg) => toast(msg, { duration: 6000 }));
(async () => {
  try {
    await store.load();
  } catch (err) {
    console.error('Avvio non riuscito', err);
  }
  store.subscribe((source) => {
    if (source !== 'local' && store.currentUser() && isBusy()) { deferredRender = true; return; }
    if (source !== 'local' && loginPick) return; // non interrompere chi sta scrivendo la password
    render();
  });
  render();
})();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  // quando arriva una versione nuova dell'app la pagina si ricarica da sola (una volta),
  // ma mai mentre si sta compilando qualcosa: in quel caso aspetta il prossimo cambio di schermata
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  const reloadWhenIdle = () => {
    if (reloaded) return;
    if (isBusy() || document.querySelector('.sheet-wrap')) {
      window.addEventListener('hashchange', reloadWhenIdle, { once: true });
      return;
    }
    reloaded = true;
    location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) reloadWhenIdle();
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then((reg) => reg.update())
    .catch((err) => console.warn('Service worker non registrato', err));
}

// Sul telefono l'app installata resta aperta in sottofondo per giorni e non ricarica i file:
// ogni volta che torna in primo piano controlla se è uscita una versione nuova e si aggiorna.
const APP_VERSION = 'v24';
let updating = false;
async function checkForUpdate({ force = false } = {}) {
  if (updating || !navigator.onLine || !location.protocol.startsWith('http')) return;
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const { version } = await res.json();
    if (!version || version === APP_VERSION) return;
    // già ricaricato per questa versione ma i file nuovi non sono ancora arrivati: si aspetta un po' (niente ricariche a ripetizione)
    let tried = null;
    try { tried = JSON.parse(sessionStorage.getItem('ftg-aggiornamento') || 'null'); } catch { /* niente */ }
    if (!force && tried?.version === version && Date.now() - tried.at < 15 * 60 * 1000) return;
    if (!force && (isBusy() || document.querySelector('.sheet-wrap'))) { showUpdateBar(); return; }
    try { sessionStorage.setItem('ftg-aggiornamento', JSON.stringify({ version, at: Date.now() })); } catch { /* niente */ }
    await applyUpdate();
  } catch { /* offline: si riprova la prossima volta */ }
}
async function applyUpdate() {
  updating = true;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
    for (const k of await caches.keys()) await caches.delete(k);
  } catch { /* niente */ }
  location.reload();
}
function showUpdateBar() {
  if (document.getElementById('update-bar')) return;
  const bar = document.createElement('div');
  bar.id = 'update-bar';
  bar.className = 'update-bar';
  bar.innerHTML = `<span>È disponibile una versione nuova dell’app</span><button class="btn btn-sm">Aggiorna</button>`;
  bar.querySelector('button').addEventListener('click', () => checkForUpdate({ force: true }));
  document.body.appendChild(bar);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
window.addEventListener('focus', () => checkForUpdate());
setInterval(() => checkForUpdate(), 30 * 60 * 1000);
setTimeout(() => checkForUpdate(), 3000);
