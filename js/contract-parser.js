// Lettura automatica del contratto: trova i lavori previsti, quante volte e in che periodo.
// È una proposta: prima di salvare, Martina controlla e corregge nel modulo.
// (Passo successivo possibile: lettura con intelligenza artificiale, più precisa sui contratti complessi.)

const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Impossibile caricare il lettore PDF: serve la connessione internet.'));
    document.head.appendChild(s);
  });
}

/** Estrae il testo da un PDF (solo PDF con testo: le scansioni/foto non hanno testo leggibile) */
export async function pdfToText(file) {
  if (!window.pdfjsLib) await loadScript(PDFJS_URL);
  const lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    let line = [];
    let lastY = null;
    for (const item of content.items) {
      const y = Math.round(item.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 2 && line.length) { lines.push(line.join(' ')); line = []; }
      if (item.str) line.push(item.str);
      lastY = y;
      if (item.hasEOL && line.length) { lines.push(line.join(' ')); line = []; lastY = null; }
    }
    if (line.length) lines.push(line.join(' '));
    lines.push('');
  }
  return lines.join('\n').replace(/[ \t]+/g, ' ').trim();
}

// ---------- Analisi del testo ----------

// Stessa lunghezza del testo originale (serve per mostrare il pezzo di contratto trovato)
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[’‘`´]/g, "'");

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Parole chiave per tipo di lavoro: prima le espressioni più specifiche
const KEYWORDS = [
  // il materiale di risulta non è un lavoro da pianificare: la frase viene "consumata" qui per non confonderla con altri lavori
  ['materiale-risulta', ['raccolta e smaltimento del materiale di risulta', 'raccolta e smaltimento materiale di risulta', 'smaltimento del materiale di risulta', 'smaltimento materiale di risulta', 'raccolta del materiale di risulta', 'materiale di risulta', 'materiali di risulta', 'smaltimento del verde', 'smaltimento sfalci']],
  ['siepi', ['potatura delle siepi', 'potatura siepi', 'taglio delle siepi', 'taglio siepi', 'rifilatura delle siepi', 'rifilatura siepi', 'siepi', 'siepe']],
  ['foglie', ['raccolta delle foglie', 'raccolta foglie', 'raccolte foglie', 'rimozione delle foglie', 'rimozione foglie', 'pulizia foglie', 'soffiatura foglie', 'foglie']],
  ['taglio-erba', ["taglio dell'erba", "tagli dell'erba", "taglio d'erba", 'taglio erba', 'tagli erba', 'taglio del prato', 'tagli del prato', 'taglio prato', 'tagli prato', 'taglio dei prati', 'tagli dei prati', 'sfalcio', 'sfalci', 'rasatura', 'rasature', 'tosatura del prato', 'falciatura', 'falciature']],
  ['abbattimento', ['abbattimento', 'abbattimenti']],
  ['potatura', ['potatura dei cespugli', 'potature dei cespugli', 'potatura cespugli', 'potature cespugli', 'potatura degli arbusti', 'potature degli arbusti', 'potatura', 'potature', 'cespugli', 'arbusti']],
  ['realizzazione', ['realizzazione', 'realizzazioni', 'messa a dimora', 'piantumazione', 'piantumazioni', 'nuovi impianti']],
  ['diserbo', ['utilizzo del diserbante', 'utilizzo di diserbante', 'uso del diserbante', 'trattamento diserbante', 'trattamenti diserbanti', 'diserbo', 'diserbi', 'diserbante', 'diserbanti', 'erbe infestanti']],
  ['concimazione', ['concimazione', 'concimazioni', 'fertilizzazione']],
  ['irrigazione', ['impianto di irrigazione', 'impianto irriguo', 'irrigazione']],
  ['pulizia', ['pulizia delle aree verdi', 'pulizia aree verdi', 'pulizia area verde', 'pulizia generale', 'pulizia del giardino', 'pulizia']],
];

const NUM_WORDS = { due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10, undici: 11, dodici: 12, tredici: 13, quattordici: 14, quindici: 15, sedici: 16, diciassette: 17, diciotto: 18, diciannove: 19, venti: 20, ventiquattro: 24, trenta: 30 };

const MONTH_KEYS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

const SEASON_WORDS = [
  [/primaver/, [3, 4, 5]],
  [/\bestat|\bestiv/, [6, 7, 8]],
  [/autunn/, [10, 11, 12]], // per il giardinaggio: il periodo della caduta delle foglie
  [/invern/, [12, 1, 2]],
  [/periodo vegetativo/, [3, 4, 5, 6, 7, 8, 9, 10]],
];

const FREQUENCIES = [
  [/settimanal|ogni settimana|volta (a|alla|per) settimana/, (mc) => Math.round(mc * 4.3)],
  [/quindicinal|ogni (15|quindici) giorni|ogni due settimane|(2|due) volte al mese/, (mc) => mc * 2],
  [/mensil|ogni mese|volta al mese/, (mc) => mc],
  [/bimestral|ogni (2|due) mesi/, (mc) => Math.max(1, Math.round(mc / 2))],
  [/trimestral|ogni (3|tre) mesi/, (mc) => Math.max(1, Math.round(mc / 3))],
  [/semestral|ogni (6|sei) mesi/, () => 2],
];

const blank = (s, re) => s.replace(re, (m) => ' '.repeat(m.length));

function monthsIn(text) {
  const set = new Set();
  const mk = MONTH_KEYS.join('|');
  const range = new RegExp(`(${mk})\\s*(?:-|–|/|a|ad|al|fino a)\\s*(?:tutto\\s+|fine\\s+)?(${mk})`, 'g');
  for (const m of text.matchAll(range)) {
    let a = MONTH_KEYS.indexOf(m[1]) + 1;
    const b = MONTH_KEYS.indexOf(m[2]) + 1;
    for (let i = 0; i < 12; i++) { set.add(a); if (a === b) break; a = (a % 12) + 1; }
  }
  if (!set.size) {
    MONTH_KEYS.forEach((k, i) => { if (new RegExp(`\\b${k}\\b`).test(text)) set.add(i + 1); });
  }
  for (const [re, months] of SEASON_WORDS) if (re.test(text)) months.forEach((m) => set.add(m));
  return [...set].sort((a, b) => a - b);
}

function numbersIn(text) {
  let t = blank(text, /\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}/g); // date
  t = blank(t, /(€|euro)\s*\d[\d.,]*|\d[\d.,]*\s*(€|euro)/g); // prezzi
  t = blank(t, /\d[\d.,]*\s*(mq|m2|metri|ml|cm|%|anni|ore|h\b|kg|lt)/g); // misure
  t = blank(t, /\b(art|articolo|punto|comma|allegato|pag|pagina)\s*\d+/g);
  const out = [];
  for (const m of t.matchAll(/\d+(?:[.,]\d+)?/g)) {
    if (/[.,]/.test(m[0])) continue;
    const value = Number(m[0]);
    if (value >= 1 && value <= 60) out.push({ value, start: m.index, end: m.index + m[0].length });
  }
  for (const m of t.matchAll(/\b[a-z]+\b/g)) {
    if (NUM_WORDS[m[0]]) out.push({ value: NUM_WORDS[m[0]], start: m.index, end: m.index + m[0].length, word: true });
  }
  return out;
}

function segmentRanges(N) {
  const ranges = [];
  let start = 0;
  const re = /[.;]\s+|\n\s*\n|\n(?=\s*(?:[-•*▪]|\d{1,2}[).]\s|[a-z]\)\s))/g;
  for (const m of N.matchAll(re)) {
    const end = m.index + 1;
    if (end - start > 2) ranges.push([start, end]);
    start = m.index + m[0].length;
  }
  if (N.length - start > 2) ranges.push([start, N.length]);
  return ranges;
}

function keywordList(workTypes) {
  const list = KEYWORDS.map(([id, words]) => [id, words]);
  for (const t of workTypes) if (!KEYWORDS.some(([id]) => id === t.id)) list.unshift([t.id, [norm(t.name)]]);
  return list
    .filter(([id]) => id === 'materiale-risulta' || workTypes.some((t) => t.id === id))
    .map(([id, words]) => [id, words.map((w) => new RegExp(`\\b${w.split(/\s+/).map(escapeRe).join('\\s+')}\\b`, 'g'))]);
}

/**
 * @returns {{ meta: object, works: Array<{typeId, qty, months, qtyFound, monthsFound, snippet}> }}
 */
export function parseContract(original, workTypes) {
  let N = norm(original).replace(/\b(n|nr|num|sig|sigg|dott|geom|rag|avv|ing|arch)\.\s?/g, (m) => m.replace('.', ' '));
  const aligned = N.length === original.length;
  const keywords = keywordList(workTypes);
  const found = [];

  for (const [a, b] of segmentRanges(N)) {
    const seg = N.slice(a, b);
    // 1. parole chiave senza sovrapposizioni
    const matches = [];
    for (const [typeId, regs] of keywords) {
      for (const re of regs) {
        for (const m of seg.matchAll(re)) {
          const s = m.index;
          const e = s + m[0].length;
          if (matches.some((x) => s < x.end && e > x.start)) continue;
          matches.push({ typeId, start: s, end: e });
        }
      }
    }
    matches.sort((x, y) => x.start - y.start);

    // 2. per ogni parola chiave: numeri, frequenza e mesi nella zona vicina
    matches.forEach((m, i) => {
      const from = Math.max(i ? matches[i - 1].end : 0, m.start - 50);
      const to = Math.min(i < matches.length - 1 ? matches[i + 1].start : seg.length, m.end + 120);
      const zone = seg.slice(from, to);
      const kStart = m.start - from;
      const kEnd = m.end - from;

      const months = monthsIn(zone);
      const monthsCount = months.length || workTypes.find((t) => t.id === m.typeId)?.months.length || 6;

      let qty = null;
      let best = Infinity;
      for (const n of numbersIn(zone)) {
        const dist = n.end <= kStart ? kStart - n.end : n.start >= kEnd ? (n.start - kEnd) * 0.8 : Infinity;
        const limit = n.end <= kStart ? 30 : 70;
        const score = dist + (n.word ? 5 : 0);
        if (dist <= limit && score < best) { best = score; qty = n.value; }
      }
      let how = qty ? 'numero' : null;
      if (!qty) {
        const freq = FREQUENCIES.find(([re]) => re.test(zone));
        if (freq) { qty = freq[1](monthsCount); how = 'frequenza'; }
      }

      const snippetFrom = a + Math.max(0, from - 10);
      const snippetTo = a + Math.min(seg.length, to);
      found.push({
        typeId: m.typeId,
        qty,
        how,
        months,
        snippet: (aligned ? original : N).slice(snippetFrom, snippetTo).replace(/\s+/g, ' ').trim(),
      });
    });
  }

  // 3. unisce le occorrenze dello stesso lavoro
  const works = [];
  for (const f of found) {
    const w = works.find((x) => x.typeId === f.typeId);
    if (!w) {
      works.push({ typeId: f.typeId, qty: f.qty, qtyFound: !!f.qty, months: f.months, monthsFound: f.months.length > 0, snippet: f.snippet });
      continue;
    }
    if (f.qty && !w.qtyFound) { w.qty = f.qty; w.qtyFound = true; w.snippet = f.snippet; }
    else if (f.qty && w.qtyFound && f.months.length && w.months.length && f.months.join() !== w.months.join()) { w.qty += f.qty; }
    else if (f.qty && w.qtyFound) { w.qty = Math.max(w.qty, f.qty); }
    if (f.months.length) { w.months = [...new Set([...w.months, ...f.months])].sort((x, y) => x - y); w.monthsFound = true; }
  }
  for (const w of works) {
    if (!w.qty) w.qty = 1;
    if (!w.monthsFound) w.months = [...(workTypes.find((t) => t.id === w.typeId)?.months || [])];
  }

  return { meta: extractMeta(original, norm(original)), works: works.filter((w) => workTypes.some((t) => t.id === w.typeId)) };
}

function titleCase(s) {
  return s.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (m, p, c) => p + c.toUpperCase());
}

function extractMeta(O, N) {
  const meta = {};
  const aligned = O.length === N.length;
  const src = aligned ? O : N;

  // Nome del condominio
  const nm = N.match(/\b(supercondominio|condominio|residenza|complesso residenziale)\s+(?:denominato\s+)?["“«']?([a-z0-9][^\n,;:()"”»]{1,50})/);
  if (nm) {
    let name = src.slice(nm.index + nm[0].length - nm[2].length, nm.index + nm[0].length);
    name = name.split(/\s+(?:sito|sita|con sede|in via|via|viale|piazza|corso|rappresentat\w*|c\.?\s?f\.?|p\.?\s?iva|codice|di seguito|nella persona|in persona)\b/i)[0];
    name = name.replace(/[\s.\-–]+$/, '').trim();
    if (name.length > 1) {
      const kind = nm[1] === 'complesso residenziale' ? 'Complesso residenziale' : titleCase(nm[1]);
      meta.name = `${kind} ${name === name.toUpperCase() ? titleCase(name) : name}`;
    }
  }

  // Indirizzo (+ città se subito dopo)
  const ad = N.match(/\b(via|viale|v\.le|piazza|p\.zza|piazzale|corso|largo|strada|vicolo|borgo)\s+([a-z' .]{2,40}?)\s*,?\s*(?:n\.?\s*|nr\.?\s*|civico\s*)?(\d{1,4}\s*[a-z]?(?:\/\s*[a-z0-9]{1,3})?)\b/);
  if (ad) {
    const raw = src.slice(ad.index, ad.index + ad[0].length).replace(/\s+/g, ' ').trim();
    meta.address = raw === raw.toUpperCase() ? titleCase(raw) : raw.charAt(0).toUpperCase() + raw.slice(1);
    const after = src.slice(ad.index + ad[0].length, ad.index + ad[0].length + 60);
    const city = after.match(/^\s*[,–-]?\s*(?:\d{5}\s+)?(?:in\s+|a\s+)?(\p{Lu}[\p{L}' ]{2,30}?)\s*(?:\((\p{Lu}{2})\))?\s*(?=[\n,.;]|$)/u);
    if (city) meta.city = city[1] === city[1].toUpperCase() ? titleCase(city[1]) : city[1];
  }

  // Amministratore
  const am = N.match(/amministrat(?:ore|rice)(?:\s+pro[\s-]?tempore)?\s*[:,\-–]?\s*(?:(?:sig|sigg|sig\.ra|dott|dott\.ssa|geom|rag|avv|studio)\.?\s*)?/);
  if (am) {
    const tail = src.slice(am.index + am[0].length, am.index + am[0].length + 60);
    const who = tail.match(/^(\p{Lu}[\p{L}'.]+(?:[ \t]+\p{Lu}[\p{L}'.]+){0,3})/u);
    if (who) {
      const name = who[1].split(/\.(?=\s|$)/)[0].trim();
      meta.adminName = name === name.toUpperCase() ? titleCase(name) : name;
    }
  }

  const tel = N.match(/\b(?:tel|telefono|cell|cellulare)\b\s*[:.]?\s*(\+?\d[\d\s/.-]{6,16}\d)/);
  if (tel) meta.phone = tel[1].replace(/\s+/g, ' ').trim();

  const mail = O.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (mail) meta.email = mail[0].replace(/[.-]+$/, '');

  // Periodo del contratto
  const d = '(\\d{1,2})\\s*[/.-]\\s*(\\d{1,2})\\s*[/.-]\\s*(\\d{2,4})';
  const toISO = (dd, mm, yy) => `${yy.length === 2 ? '20' + yy : yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  const period = N.match(new RegExp(`dal\\s+${d}\\s+(?:al|fino al)\\s+${d}`));
  if (period) {
    meta.contractStart = toISO(period[1], period[2], period[3]);
    meta.contractEnd = toISO(period[4], period[5], period[6]);
  } else {
    const start = N.match(new RegExp(`(?:decorrenza|a partire dal|inizio)\\s+(?:dal\\s+)?${d}`));
    if (start) {
      meta.contractStart = toISO(start[1], start[2], start[3]);
      const s = new Date(Number(meta.contractStart.slice(0, 4)), Number(meta.contractStart.slice(5, 7)) - 1, Number(meta.contractStart.slice(8, 10)));
      s.setFullYear(s.getFullYear() + 1);
      s.setDate(s.getDate() - 1);
      meta.contractEnd = `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}-${String(s.getDate()).padStart(2, '0')}`;
    } else {
      const year = N.match(/\banno\s+(20\d{2})\b/);
      if (year) { meta.contractStart = `${year[1]}-01-01`; meta.contractEnd = `${year[1]}-12-31`; }
    }
  }
  return meta;
}
