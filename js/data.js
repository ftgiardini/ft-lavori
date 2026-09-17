// Dati di partenza: tipi di lavoro con periodo stagionale predefinito e squadra.
// I mesi sono numeri 1-12. Tutto è modificabile dall'app (Altro → Tipi di lavoro / Squadra).

// I lavori previsti nei contratti dei condomini FT Giardini.
// "months" sono i mesi proposti di default: in ogni contratto si possono cambiare.
export const DEFAULT_WORK_TYPES = [
  { id: 'taglio-erba', name: 'Sfalci', icon: 'grass', color: '#48AB33', months: [4, 5, 6, 7, 8, 9, 10] },
  { id: 'potatura', name: 'Potatura cespugli', icon: 'scissors', color: '#8A5A3B', months: [3, 4, 5, 6, 7, 8, 9, 10] },
  { id: 'foglie', name: 'Raccolta foglie', icon: 'leaf', color: '#D9772B', months: [10, 11, 12] },
  { id: 'diserbo', name: 'Utilizzo diserbante', icon: 'spray', color: '#B8962E', months: [4, 5, 6, 7, 8, 9] },
];
// Il materiale di risulta non è un lavoro a parte: si raccoglie sempre a fine cantiere
export const WORK_TYPES_VERSION = 3;

// Livelli di accesso. Ogni permesso sblocca schermate e azioni:
//  gestione     Home gestionale, spostare/assegnare/eliminare interventi, dati completi dei contratti
//  condomini    elenco condomini, nuovo condominio, modifica contratto, ripianifica
//  elimina      eliminare un condominio
//  impostazioni tipi di lavoro e giorni lavorativi
//  squadra      schermata Squadra: attività dei giardinieri, persone, ruoli e password
//  backup       scaricare il backup
//  dati         caricare un backup, cancellare tutto
//  pagamenti    rate e incassi dei clienti, contatti, controllo dei conti
// "home" dice quale Home vede la persona: 'gestione' (lavori) · 'scadenze' (contratti e appuntamenti)
export const ROLES = {
  titolare: { label: 'Titolare', desc: 'Controllo completo: squadra, password, condomini e dati', home: 'gestione', perms: ['gestione', 'condomini', 'elimina', 'impostazioni', 'squadra', 'backup', 'dati', 'pagamenti'] },
  ufficio: { label: 'Ufficio', desc: 'Condomini, contratti, pianificazione, assegnazioni e pagamenti', home: 'gestione', perms: ['gestione', 'condomini', 'impostazioni', 'backup', 'pagamenti'] },
  amministrazione: { label: 'Amministrazione', desc: 'Contabilità: pagamenti dei clienti, contatti, scadenze e controllo dei lavori', home: 'scadenze', perms: ['gestione', 'condomini', 'backup', 'pagamenti'] },
  giardiniere: { label: 'Giardiniere', desc: 'Calendario e spunta dei propri lavori', home: 'oggi', perms: [] },
};

// field: true = va nei cantieri (può ricevere lavori). role: una chiave di ROLES.
// days: giorni in cui lavora (0=dom … 6=sab); se manca, lavora in tutti i giorni lavorativi.
// Serve solo per la modalità prova (senza database). Con Supabase la squadra e le password
// stanno nel database: nessuna password, nemmeno cifrata, è scritta nel codice pubblicato.
export const DEFAULT_TEAM = [
  { id: 'nicolas', name: 'Nicolas', role: 'titolare', title: 'Titolare · Capo giardiniere', field: true, color: '#2A7D2E' },
  { id: 'martina', name: 'Martina', role: 'ufficio', title: 'Ufficio · Pianificazione', field: false, color: '#48AB33' },
  { id: 'alessandro', name: 'Alessandro', role: 'amministrazione', title: 'Schiacciapollici', field: true, color: '#8A5A3B' },
  { id: 'leonardo', name: 'Leonardo', role: 'giardiniere', title: 'Giardiniere', field: true, color: '#4F7CAC' },
  { id: 'manuel', name: 'Manuel', role: 'giardiniere', title: 'Giardiniere', field: true, color: '#7B61C9', days: [6] },
  { id: 'tomas', name: 'Thomas', role: 'giardiniere', title: 'Giardiniere', field: true, color: '#D9772B' },
];

// Voci del calendario che non sono lavori dei contratti
export const EVENT_KINDS = [
  { id: 'appuntamento', label: 'Appuntamento', icon: 'calendar', color: '#4F7CAC', placeholder: 'Es. Sopralluogo con l’amministratore' },
  { id: 'promemoria', label: 'Promemoria', icon: 'bell', color: '#D99A1E', placeholder: 'Es. Chiamare il vivaio per le piante' },
  { id: 'lavoro', label: 'Lavoro extra', icon: 'tool', color: '#7B61C9', placeholder: 'Es. Potatura giardino privato via Roma' },
];
export const eventKind = (id) => EVENT_KINDS.find((k) => k.id === id) || EVENT_KINDS[0];

// Ripetizione di un lavoro del contratto: serve a proporre le date (vedi scheduler.js)
export const PLAN_MODES = [
  { id: 'mensile', label: 'Giorni del mese', hint: 'Es. il 5 e il 20 di ogni mese' },
  { id: 'settimanale', label: 'Giorni della settimana', hint: 'Es. ogni martedì, o ogni 2 settimane' },
];
export const DEFAULT_PLAN = { mode: '', days: [], weekdays: [], every: 1 };

// Durate rapide quando si registra un lavoro fatto (minuti)
export const DURATIONS = [30, 60, 90, 120, 180, 240, 360, 480];

// Come si ripete una rata quando la si inserisce (mesi tra una rata e l'altra)
export const PAYMENT_REPEATS = [[0, 'Una volta'], [1, 'Ogni mese'], [2, 'Ogni 2 mesi'], [3, 'Ogni 3 mesi'], [6, 'Ogni 6 mesi']];
export const PAYMENT_METHODS = ['Bonifico', 'Contanti', 'Assegno', 'Carta', 'Altro'];

export const POSTPONE_REASONS = ['Maltempo', 'Tempo insufficiente', 'Accesso non possibile', 'Mezzi / attrezzi', 'Altro'];

export const WORK_COLORS = ['#48AB33', '#2A7D2E', '#6E9F4E', '#8A5A3B', '#D9772B', '#B8962E', '#4F7CAC', '#2B8FA8', '#7B61C9', '#B5523B', '#7A8794'];
