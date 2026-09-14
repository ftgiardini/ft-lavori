// Preventivo in PDF con lo stesso impaginato del modello FT Giardini (foglio Letter 612 × 792 pt).
// Il disegno è scritto una volta sola e usato sia per il PDF (jsPDF) sia per l'anteprima a schermo (canvas),
// così quello che si vede è esattamente quello che si scarica.

export const COMPANY = { email: 'ftgiardini@gmail.com', phone: '+39 324 958 8459' };
export const NOTE = 'In caso di accettazione del preventivo è richiesto il 50% del totale in anticipo';
export const MAX_ROWS = 15;
export const PAGE = { w: 612, h: 792 };

const GREEN = '#34A853';
const DARK = '#000000';
const LIGHT = '#E2E2E2';
const LINK = '#1155CC';

// Misure prese dal modello
const L = 50;
const R = 562;
const TOP = 53.1;
const LOGO_BOTTOM = 222.5;
const HEAD_BOTTOM = 250;
const ROW_H = 20.33;
const ROWS_BOTTOM = HEAD_BOTTOM + MAX_ROWS * ROW_H; // 555
const NOTE_BOTTOM = 575;
const TOTAL_BOTTOM = 603.75;
const GRID_Y = [618.75, 637.5, 656.25, 670, 691.9];
const COL = 413; // colonna Prezzo
const C1 = 188;
const C2 = 317;
const C3 = 489;
const PAD = 2.4;

const ASSETS = {
  logo: { src: 'img/preventivo-logo.png', ratio: 900 / 629 },
  mail: { src: 'img/preventivo-mail.png', ratio: 96 / 67 },
  tel: { src: 'img/preventivo-tel.png', ratio: 1 },
};

/** Testo del prezzo: "150" → "150€", "2000 l'anno" → "2000€ l'anno", il resto invariato */
export function formatAmount(value) {
  const v = String(value ?? '').trim();
  if (!v) return '';
  if (/€|euro/i.test(v)) return v;
  const m = v.match(/^(\d[\d.,]*)\s*(.*)$/);
  return m ? `${m[1]}€${m[2] ? ' ' + m[2] : ''}` : v;
}

/** Riduce la dimensione del testo (fino a un minimo) e poi lo accorcia per farlo stare nello spazio */
function fit(r, str, size, bold, maxW, min = 8) {
  let s = size;
  let text = String(str ?? '');
  while (s > min && r.measure(text, s, bold) > maxW) s -= 0.25;
  if (r.measure(text, s, bold) > maxW) {
    while (text.length > 1 && r.measure(text + '…', s, bold) > maxW) text = text.slice(0, -1);
    text = text.trimEnd() + '…';
  }
  return { text, size: s };
}

/**
 * Disegna il preventivo.
 * @param r  renderer con fill, stroke, line, text, measure, image (unità: punti tipografici)
 * @param q  { client, services: [{ text, price }], total }
 */
export function drawQuote(r, q) {
  const services = (q.services || []).filter((s) => String(s.text || '').trim() || String(s.price || '').trim()).slice(0, MAX_ROWS);

  // ---- riempimenti verdi
  r.fill(COL, NOTE_BOTTOM, R - COL, TOTAL_BOTTOM - NOTE_BOTTOM, GREEN);
  r.fill(L, GRID_Y[0], C1 - L, GRID_Y[2] - GRID_Y[0], GREEN);

  // ---- griglia chiara (parte bassa)
  const light = (x1, y1, x2, y2) => r.line(x1, y1, x2, y2, LIGHT, 0.6);
  for (const y of GRID_Y) light(L, y, R, y);
  light(L, TOTAL_BOTTOM, R, TOTAL_BOTTOM);
  light(L, NOTE_BOTTOM, L, GRID_Y[4]);
  light(R, TOTAL_BOTTOM, R, GRID_Y[4]);
  light(C1, NOTE_BOTTOM, C1, GRID_Y[4]);
  light(C3, TOTAL_BOTTOM, C3, GRID_Y[4]);
  for (const x of [C2, COL]) {
    light(x, TOTAL_BOTTOM, x, GRID_Y[0]);
    light(x, GRID_Y[2], x, GRID_Y[4]);
  }
  // le celle verdi coprono la griglia sotto
  r.fill(L + 0.3, GRID_Y[0] + 0.3, C1 - L - 0.6, GRID_Y[2] - GRID_Y[0] - 0.6, GREEN);

  // ---- tabella principale
  const dark = (x1, y1, x2, y2) => r.line(x1, y1, x2, y2, DARK, 0.75);
  dark(L, TOP, R, TOP);
  dark(L, LOGO_BOTTOM, R, LOGO_BOTTOM);
  for (let i = 0; i <= MAX_ROWS; i++) dark(L, HEAD_BOTTOM + i * ROW_H, R, HEAD_BOTTOM + i * ROW_H);
  dark(L, NOTE_BOTTOM, R, NOTE_BOTTOM);
  dark(L, TOP, L, NOTE_BOTTOM);
  dark(R, TOP, R, TOTAL_BOTTOM);
  dark(COL, LOGO_BOTTOM, COL, TOTAL_BOTTOM);
  dark(COL, TOTAL_BOTTOM, R, TOTAL_BOTTOM);

  // ---- logo
  const logoW = 184;
  r.image('logo', 301.5 - logoW / 2, 83, logoW, logoW / ASSETS.logo.ratio);

  // ---- intestazione
  const client = fit(r, q.client || '', 11, true, COL - L - PAD * 2);
  r.text(client.text, L + PAD, 240.1, { size: client.size, bold: true });
  r.text('Prezzo', (COL + R) / 2, 241.2, { size: 13.5, bold: true, align: 'center' });

  // ---- servizi
  services.forEach((s, i) => {
    const base = HEAD_BOTTOM + i * ROW_H + 14.3;
    const t = fit(r, s.text, 11, false, COL - L - PAD * 2);
    r.text(t.text, L + PAD, base, { size: t.size });
    const price = formatAmount(s.price);
    if (price) {
      const p = fit(r, price, 11, false, R - COL - 8);
      r.text(p.text, (COL + R) / 2, base, { size: p.size, align: 'center' });
    }
  });

  // ---- nota e totale
  const note = fit(r, NOTE, 9.3, false, COL - L - PAD * 2);
  r.text(note.text, L + PAD, 568.1, { size: note.size });
  r.text('TOTALE', COL - 6, 594.2, { size: 13.5, bold: true, align: 'right' });
  const total = formatAmount(q.total);
  if (total) {
    const t = fit(r, total, 13.5, true, R - COL - 8);
    r.text(t.text, (COL + R) / 2, 594.2, { size: t.size, bold: true, align: 'center', color: '#FFFFFF' });
  }

  // ---- contatti (fissi)
  r.text('CONTATTI', (L + C1) / 2, 642.4, { size: 13.5, bold: true, align: 'center', color: '#FFFFFF' });
  r.text(COMPANY.email, 479, 633.3, { size: 13.5, align: 'right', color: LINK, underline: true, link: `mailto:${COMPANY.email}` });
  r.text(COMPANY.phone, 486, 652.1, { size: 13.5, align: 'right', link: `tel:${COMPANY.phone.replace(/\s+/g, '')}` });
  const mailW = 11.5;
  r.image('mail', 525.4 - mailW / 2, 628.4 - mailW / ASSETS.mail.ratio / 2, mailW, mailW / ASSETS.mail.ratio);
  const telW = 9.8;
  r.image('tel', 525.4 - telW / 2, 647.2 - telW / 2, telW, telW);
}

// ---------- PDF (jsPDF) ----------

function pdfRenderer(doc, images) {
  const font = (size, bold) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); };
  return {
    fill(x, y, w, h, color) { doc.setFillColor(color); doc.rect(x, y, w, h, 'F'); },
    line(x1, y1, x2, y2, color, width) { doc.setDrawColor(color); doc.setLineWidth(width); doc.line(x1, y1, x2, y2); },
    measure(str, size, bold) { font(size, bold); return doc.getTextWidth(str); },
    text(str, x, y, o = {}) {
      if (!str) return;
      font(o.size, o.bold);
      doc.setTextColor(o.color || '#000000');
      doc.text(str, x, y, { align: o.align || 'left', baseline: 'alphabetic' });
      const w = doc.getTextWidth(str);
      const x0 = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
      if (o.underline) { doc.setDrawColor(o.color || '#000000'); doc.setLineWidth(0.7); doc.line(x0, y + 1.6, x0 + w, y + 1.6); }
      if (o.link) doc.link(x0, y - o.size, w, o.size * 1.3, { url: o.link });
    },
    image(key, x, y, w, h) { if (images[key]) doc.addImage(images[key], 'PNG', x, y, w, h, key, 'FAST'); },
  };
}

/** Crea il documento PDF. jsPDF: il costruttore (window.jspdf.jsPDF); images: data URL delle immagini */
export function buildQuotePdf(jsPDF, q, images) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
  doc.setProperties({ title: quoteTitle(q), author: 'FT Giardini', creator: 'FT Giardini · Lavori' });
  drawQuote(pdfRenderer(doc, images), q);
  return doc;
}

/** Nome proposto per il file: "Preventivo FT Giardini - Nome Cognome" */
export function defaultQuoteName(q) {
  return `Preventivo FT Giardini${q.client?.trim() ? ' - ' + q.client.trim() : ''}`;
}

/** Nome sicuro per il file (senza caratteri non ammessi), senza estensione */
export function cleanFileName(name) {
  return String(name || '')
    .trim()
    .replace(/\.pdf$/i, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/** Titolo del documento: il nome scelto oppure quello proposto */
export function quoteTitle(q) {
  return cleanFileName(q.fileName) || cleanFileName(defaultQuoteName(q)) || 'Preventivo FT Giardini';
}

export function quoteFileName(q) {
  return `${quoteTitle(q)}.pdf`;
}

// ---------- Anteprima a schermo (canvas) ----------

export function drawQuoteOnCanvas(canvas, q, imgs) {
  const ctx = canvas.getContext('2d');
  const s = canvas.width / PAGE.w;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(s, 0, 0, s, 0, 0);
  const font = (size, bold) => { ctx.font = `${bold ? 'bold ' : ''}${size}px Helvetica, Arial, sans-serif`; };
  drawQuote({
    fill(x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); },
    line(x1, y1, x2, y2, color, width) { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); },
    measure(str, size, bold) { font(size, bold); return ctx.measureText(str).width; },
    text(str, x, y, o = {}) {
      if (!str) return;
      font(o.size, o.bold);
      ctx.fillStyle = o.color || '#000000';
      ctx.textAlign = o.align || 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(str, x, y);
      if (o.underline) {
        const w = ctx.measureText(str).width;
        const x0 = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
        ctx.fillRect(x0, y + 1.2, w, 0.7);
      }
    },
    image(key, x, y, w, h) { if (imgs[key]) ctx.drawImage(imgs[key], x, y, w, h); },
  }, q);
}

// ---------- Caricamento risorse (browser) ----------

let assetsPromise = null;
/** Immagini del modello: { data: data URL per il PDF, img: elementi per l'anteprima } */
export function loadQuoteAssets() {
  assetsPromise ??= Promise.all(Object.entries(ASSETS).map(async ([key, a]) => {
    const blob = await (await fetch(a.src)).blob();
    const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
    const img = await new Promise((res, rej) => {
      const el = new Image();
      el.onload = () => res(el);
      el.onerror = () => rej(new Error(`Immagine non caricata: ${a.src}`));
      el.src = data;
    });
    return [key, data, img];
  })).then((list) => ({
    data: Object.fromEntries(list.map(([k, d]) => [k, d])),
    img: Object.fromEntries(list.map(([k, , i]) => [k, i])),
  })).catch((err) => { assetsPromise = null; throw err; });
  return assetsPromise;
}

let jsPdfPromise = null;
/** Carica jsPDF solo quando serve (i giardinieri non lo scaricano mai) */
export function loadJsPdf() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  jsPdfPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/jspdf.umd.min.js';
    s.onload = () => resolve(window.jspdf.jsPDF);
    s.onerror = () => { jsPdfPromise = null; reject(new Error('Generatore PDF non disponibile: controlla la connessione e riprova.')); };
    document.head.appendChild(s);
  });
  return jsPdfPromise;
}
