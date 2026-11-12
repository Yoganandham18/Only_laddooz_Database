/* =============================================================================
 * engine.js — DO NOT EDIT. This is a copy of Code.gs that runs inside the browser.
 *
 * The website downloads all rows once, then works out the dashboard, lists, filters
 * and reports here, instantly, instead of asking Google for every page.
 * Saving still goes to Google Sheets (Code.gs), which sends back the updated rows.
 *
 * Whenever Code.gs changes, replace this file with the matching engine.js too.
 * If the two versions differ the website notices and simply uses the slower way.
 * ============================================================================= */
/* Preview-only: an in-browser imitation of the Google Apps Script services that
 * Code.gs uses (SpreadsheetApp, Utilities, CacheService, PropertiesService,
 * LockService, ContentService). The REAL Code.gs runs on top of it, so every
 * calculation and validation is the production logic. Data lives in memory only. */
window.__makeGasMock = function () {
  // ---- synchronous SHA-256 (Code.gs needs a sync digest) ----
  const K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
  function sha256(bytes) {
    const l = bytes.length, bitLen = l * 8;
    const n = ((l + 9 + 63) >> 6) << 6;
    const m = new Uint8Array(n); m.set(bytes); m[l] = 0x80;
    const dv = new DataView(m.buffer);
    dv.setUint32(n - 4, bitLen >>> 0); dv.setUint32(n - 8, Math.floor(bitLen / 4294967296));
    const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    const W = new Uint32Array(64);
    const r = (x, k) => (x >>> k) | (x << (32 - k));
    for (let o = 0; o < n; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = r(W[i - 15], 7) ^ r(W[i - 15], 18) ^ (W[i - 15] >>> 3), s1 = r(W[i - 2], 17) ^ r(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
        const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    const out = []; H.forEach((w) => out.push((w >>> 24) & 255, (w >>> 16) & 255, (w >>> 8) & 255, w & 255));
    return out.map((b) => (b > 127 ? b - 256 : b)); // Apps Script returns signed bytes
  }

  // ---- sheets ----
  const sheets = new Map();
  class Range {
    constructor(sh, r, c, nr, nc) {
      if (r + nr - 1 > sh.maxRows || c + nc - 1 > sh.maxCols || nr < 1 || nc < 1) throw new Error('Range out of bounds');
      Object.assign(this, { sh, r, c, nr, nc });
    }
    getValues() {
      const out = [];
      for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) { const v = (this.sh.data[this.r - 1 + i] || [])[this.c - 1 + j]; row.push(v === undefined ? '' : v); } out.push(row); }
      return out;
    }
    setValues(vals) {
      vals.forEach((row, i) => row.forEach((v, j) => {
        const ri = this.r - 1 + i; while (this.sh.data.length <= ri) this.sh.data.push([]);
        if (typeof v === 'string' && v.charAt(0) === "'") v = v.slice(1);
        this.sh.data[ri][this.c - 1 + j] = v;
      }));
      return this;
    }
    setNumberFormats() { return this; } setNumberFormat() { return this; } clearDataValidations() { return this; } setFontWeight() { return this; } setBackground() { return this; }
  }
  class Sheet {
    constructor(name) { this.name = name; this.data = []; this.maxRows = 1000; this.maxCols = 26; }
    getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
    getDataRange() { return new Range(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
    getLastRow() { for (let i = this.data.length - 1; i >= 0; i--) if ((this.data[i] || []).some((v) => v !== '' && v !== undefined && v !== null)) return i + 1; return 0; }
    getLastColumn() { let m = 0; this.data.forEach((r) => { for (let j = r.length - 1; j >= 0; j--) if (r[j] !== '' && r[j] !== undefined) { m = Math.max(m, j + 1); break; } }); return m; }
    getMaxRows() { return this.maxRows; } getMaxColumns() { return this.maxCols; }
    insertRowsAfter(a, n) { this.maxRows += n; } insertColumnsAfter(a, n) { this.maxCols += n; } setFrozenRows() {}
  }
  const ss = { getSheetByName: (n) => sheets.get(n) || null, insertSheet: (n) => { const s = new Sheet(n); sheets.set(n, s); return s; } };

  const pad = (n) => String(n).padStart(2, '0');
  function formatDate(d, tz, pattern) {
    const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
    const map = { yyyy: ist.getUTCFullYear(), MM: pad(ist.getUTCMonth() + 1), dd: pad(ist.getUTCDate()), HH: pad(ist.getUTCHours()), mm: pad(ist.getUTCMinutes()), ss: pad(ist.getUTCSeconds()), XXX: '+05:30', yy: String(ist.getUTCFullYear()).slice(2) };
    return pattern.replace(/'([^']*)'|yyyy|yy|MM|dd|HH|mm|ss|XXX/g, (m, lit) => (lit !== undefined ? lit : map[m]));
  }
  const enc = new TextEncoder();
  const cache = new Map(), props = new Map();
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
  return {
    sheets,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush: () => {} },
    Utilities: {
      formatDate, getUuid: uuid,
      computeDigest: (alg, value) => sha256(typeof value === 'string' ? enc.encode(value) : Uint8Array.from(value.map((b) => b & 255))),
      DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' }
    },
    CacheService: { getScriptCache: () => ({ get: (k) => (cache.has(k) ? cache.get(k) : null), put: (k, v) => cache.set(k, String(v)), remove: (k) => cache.delete(k) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, String(v)), setProperties: (o) => Object.keys(o).forEach((k) => props.set(k, String(o[k]))) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ContentService: { createTextOutput: (s) => ({ s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    console: { log: () => {}, error: (...a) => window.console.warn('[server]', ...a) }
  };
};

window.LaddooEngine = {
  create: function () {
    const __m = window.__makeGasMock();
    const api = (function (SpreadsheetApp, Utilities, CacheService, PropertiesService, LockService, ContentService, console) {
/* =============================================================================
 * MILLET LADDOO BUSINESS MANAGER — Google Apps Script backend (Code.gs)
 * Simple version 3.0 — sales, payments and expenses only (no stock tracking)
 *
 * !! NO LOGIN !!  Anyone who has the web app URL (it is visible in config.js on
 * GitHub Pages) can read and change the data. Keep the link private and make a
 * copy of the Google Sheet regularly (File → Make a copy).
 *
 * GOOGLE SHEET: 3 tabs, created automatically by setup()
 *   Sales     one row per product sold; rows of the same bill share a BillID
 *   Payments  money received per bill (a refund is a negative amount)
 *   Expenses  money spent
 *
 * INSTALL
 *   1. Google Sheet → Extensions → Apps Script → paste this file and appsscript.json.
 *   2. Choose the function `setup` in the toolbar and press Run once (allow access).
 *   3. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 *
 * REQUESTS (from script.js): POST, body  payload=<JSON>  with no custom headers.
 *   { action, requestId, payload }  →  { success, message, data }  or  { success:false, message, code }
 * ============================================================================= */

/* ---------- Business settings: edit here, then Deploy → Manage deployments → new version ---------- */
const CONFIG = {
  BUSINESS_NAME: 'Millet Laddoo Business',
  // The item list (Kambu, Ragi …) lives in config.js on the website, so the drop-down works even offline.
  PAYMENT_METHODS: ['Cash', 'UPI', 'Bank transfer', 'Other'],
  EXPENSE_CATEGORIES: ['Millet', 'Ragi', 'Jaggery', 'Nuts', 'Oil or ghee', 'Raw materials', 'Packaging materials',
    'Aluminium foil', 'Boxes and labels', 'Transportation', 'Electricity', 'Other expenses'],
  BOX_SIZE: 8,               // pieces in one box (used to count pieces sold in Insights)
  TZ: 'Asia/Kolkata',
  VERSION: '3.3.0'
};

const SHEETS = {
  Sales: ['BillID', 'Date', 'Customer', 'Product', 'Unit', 'Quantity', 'Price', 'Discount', 'Amount', 'Status', 'Notes'],
  Payments: ['PaymentID', 'BillID', 'Date', 'Amount', 'Method', 'Notes', 'Status'],
  Expenses: ['ExpenseID', 'Date', 'Category', 'Description', 'Amount', 'Method', 'Notes', 'Status']
};
const NUMBER_COLS = new Set(['Quantity', 'Price', 'Discount', 'Amount']);
const RUPEE_FORMAT = '"₹"#,##0.00';
/** How a number cell looks in the sheet: money as ₹1,280.00, quantity as 20 (or 2.5). */
function numberFormat_(h, v) { return h === 'Quantity' ? (Number.isInteger(Number(v)) ? '0' : '0.###') : RUPEE_FORMAT; }
const WALKIN = 'Walk-in';

/* ============================================================================
 * Entry points
 * ========================================================================== */
function doGet() {
  return json_({ success: true, message: 'Laddoo Manager API is running.', data: { version: CONFIG.VERSION } });
}

function doPost(e) {
  return json_(handleRequest_(e));
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

class AppError extends Error { constructor(code, msg) { super(msg); this.code = code; this.isApp = true; } }
function fail_(code, msg) { throw new AppError(code, msg); }

function handleRequest_(e) {
  let req = null;
  try {
    req = parseRequest_(e);
    const route = ROUTES[req.action];
    if (!route) fail_('UNKNOWN_ACTION', 'Unknown action.');
    if (!route.write) return ok_(route.fn(req.payload, new Db()));   // reading never waits for a lock, so pages load in parallel
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) fail_('BUSY', 'Another entry is being saved. Please try again in a few seconds.');
    try {
      const db = new Db();
      // Duplicate protection: the same requestId is never applied twice (remembered for 6 hours).
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(req.requestId)) fail_('VALIDATION_ERROR', 'Missing request ID. Please reload the page.');
      const cache = CacheService.getScriptCache();
      const seen = cache.get('req_' + req.requestId);
      if (seen) return { success: true, message: 'Already saved. No duplicate was created.', data: Object.assign(JSON.parse(seen), { duplicate: true }) };
      const result = route.fn(req.payload, db);
      SpreadsheetApp.flush();
      cache.put('req_' + req.requestId, JSON.stringify(result.data || {}), 21600);
      const out = ok_(result);
      out.data._snapshot = snapshot_(db);   // the website keeps a copy of all data, so it does not have to ask again
      return out;
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    if (err && err.isApp) return { success: false, code: err.code, message: err.message };
    console.error('Error in ' + (req && req.action) + ': ' + (err && err.stack ? err.stack : err));
    return { success: false, code: 'SERVER_ERROR', message: 'Something went wrong on the server. Check Sales History before entering it again.' };
  }
}

function ok_(r) { return { success: true, message: (r && r.message) || 'OK', data: r && r.data !== undefined ? r.data : {} }; }

function parseRequest_(e) {
  let raw = e && e.parameter && e.parameter.payload;
  if (!raw && e && e.postData) raw = e.postData.contents;
  if (!raw) fail_('VALIDATION_ERROR', 'Malformed request.');
  if (raw.length > 200000) fail_('VALIDATION_ERROR', 'Request is too large.');
  let o;
  try { o = JSON.parse(raw); } catch (x) { fail_('VALIDATION_ERROR', 'Malformed request.'); }
  if (!o || typeof o.action !== 'string') fail_('VALIDATION_ERROR', 'Malformed request.');
  const p = o.payload && typeof o.payload === 'object' && !Array.isArray(o.payload) ? o.payload : {};
  return { action: o.action, requestId: typeof o.requestId === 'string' ? o.requestId : '', payload: p };
}

/* ============================================================================
 * Helpers & validation
 * ========================================================================== */
function num_(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function r2_(n) { return Math.round(num_(n) * 100 + (num_(n) >= 0 ? 1e-7 : -1e-7)) / 100; }
function paise_(n) { return Math.round(num_(n) * 100); }
function today_() { return Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd'); }
function addDays_(ymd, n) { const p = ymd.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); }
function addMonths_(ym, n) { const p = ym.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1 + n, 1)).toISOString().slice(0, 7); }
function newId_(prefix) {
  return prefix + '-' + Utilities.formatDate(new Date(), CONFIG.TZ, 'yyMMdd') + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase();
}
function inRange_(d, r) { return d >= r.from && d <= r.to; }
function groupBy_(arr, key) { const m = {}; arr.forEach(x => { (m[x[key]] = m[x[key]] || []).push(x); }); return m; }

const V = {
  str(v, field, opt) {
    opt = opt || {};
    const s = v === undefined || v === null ? '' : String(v).replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
    if (opt.required && !s) fail_('VALIDATION_ERROR', field + ' is required.');
    if (s.length > (opt.max || 200)) fail_('VALIDATION_ERROR', field + ' is too long.');
    return s;
  },
  date(v, field) {
    const s = String(v || '').trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) fail_('VALIDATION_ERROR', field + ' is not a valid date.');
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3] || +m[1] < 2000) fail_('VALIDATION_ERROR', field + ' is not a valid date.');
    if (s > today_()) fail_('VALIDATION_ERROR', field + ' cannot be in the future.');
    return s;
  },
  num(v, field, opt) {
    opt = opt || {};
    if (v === '' || v === null || v === undefined) fail_('VALIDATION_ERROR', field + ' is required.');
    const n = Number(v);
    if (!isFinite(n)) fail_('VALIDATION_ERROR', field + ' must be a number.');
    if (opt.positive && n <= 0) fail_('VALIDATION_ERROR', field + ' must be more than 0.');
    if (n < 0) fail_('VALIDATION_ERROR', field + ' cannot be negative.');
    if (n > 1e9) fail_('VALIDATION_ERROR', field + ' is too large.');
    if (opt.whole && n !== Math.floor(n)) fail_('VALIDATION_ERROR', field + ' must be a whole number.');
    if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) fail_('VALIDATION_ERROR', field + ' can have at most 2 decimals.');
    return n;
  },
  oneOf(v, list, field) { const s = String(v || '').trim(); if (list.indexOf(s) < 0) fail_('VALIDATION_ERROR', field + ' must be one of: ' + list.join(', ')); return s; },
  range(p) {
    const t = today_();
    const to = p.to ? String(p.to) : t, from = p.from ? String(p.from) : t.slice(0, 8) + '01';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) fail_('VALIDATION_ERROR', 'Choose a valid date range.');
    return { from: from, to: to };
  }
};

/* ============================================================================
 * Sheet access (columns found by header name; data is never cleared)
 * ========================================================================== */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const done = [];
  Object.keys(SHEETS).forEach(name => {
    const want = SHEETS[name];
    let sh = ss.getSheetByName(name);
    if (!sh) { sh = ss.insertSheet(name); done.push('Created ' + name); }
    const lastCol = sh.getLastColumn();
    const have = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim()) : [];
    if (!have.filter(String).length && sh.getLastRow() > 1) throw new Error('Sheet ' + name + ' has data but no header row.');
    const missing = want.filter(h => have.indexOf(h) < 0);
    if (missing.length) {
      const start = have.filter(String).length ? lastCol + 1 : 1;
      if (sh.getMaxColumns() < start + missing.length - 1) sh.insertColumnsAfter(sh.getMaxColumns(), start + missing.length - 1 - sh.getMaxColumns());
      sh.getRange(1, start, 1, missing.length).setValues([missing]).setFontWeight('bold').setBackground('#e2ebdc');
      sh.setFrozenRows(1);
      done.push(name + ': added ' + missing.join(', '));
    }
  });
  SpreadsheetApp.flush();
  console.log(done.length ? done.join('\n') : 'All 3 sheets already exist. Nothing changed.');
  return done;
}

/** Reads a number even when it was pasted as text: "₹1,280.00", "Rs. 320", " 16 ", "(50)" or "-". */
function money_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const t = String(v).trim();
  const m = /\d[\d,]*(\.\d+)?/.exec(t);              // first number in the text, e.g. "Rs. 1,220" → 1,220
  if (!m) return 0;
  const n = parseFloat(m[0].replace(/,/g, ''));
  const neg = /^\(.*\)$/.test(t) || /^-\s*(₹|rs\.?)?\s*\d/i.test(t) || /^(₹|rs\.?)\s*-/i.test(t);
  return isFinite(n) ? (neg ? -n : n) : 0;
}
/** Dates may arrive as real dates, "2026-03-15", or text typed/pasted as "15-03-2026" / "15/03/2026". */
function dateText_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, CONFIG.TZ, 'yyyy-MM-dd');
  const t = String(v === null || v === undefined ? '' : v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/.exec(t);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return t;
}
function readCell_(h, v) {
  if (h === 'Date') return dateText_(v);
  if (v instanceof Date) return Utilities.formatDate(v, CONFIG.TZ, 'yyyy-MM-dd');
  if (NUMBER_COLS.has(h)) return v === '' || v === null ? '' : money_(v);
  const s = v === null || v === undefined ? '' : String(v);
  return /^'[=+\-@]/.test(s) ? s.slice(1) : s;
}
function writeCell_(h, v) {
  if (v === undefined || v === null) return '';
  if (NUMBER_COLS.has(h)) return v === '' ? '' : Number(v);
  const s = String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;   // stop text being run as a formula
}

class Table {
  /** Reads the whole tab in ONE call (header row + data). Each call to Google Sheets is slow, so keep them few. */
  constructor(ss, name) {
    this.sheet = ss.getSheetByName(name);
    let vals = this.sheet ? this.sheet.getDataRange().getValues() : [[]];
    let head = (vals[0] || []).map(h => String(h).trim());
    if (!this.sheet || SHEETS[name].some(h => head.indexOf(h) < 0)) {      // tab or a column missing → create it, then read again
      setup(); this.sheet = ss.getSheetByName(name);
      vals = this.sheet.getDataRange().getValues(); head = (vals[0] || []).map(h => String(h).trim());
    }
    while (head.length && !head[head.length - 1]) head.pop();
    this.headers = head;
    this.rows = [];
    let last = 1;
    for (let i = 1; i < vals.length; i++) {
      const r = vals[i];
      if (r.every(v => v === '' || v === null)) continue;
      last = i + 1;
      const o = { _row: i + 1 };
      this.headers.forEach((h, j) => { if (h) o[h] = readCell_(h, r[j]); });
      this.rows.push(o);
    }
    this.next = Math.max(vals.length + 1, last + 1, 2);
  }
  append(objs) {
    if (!objs.length) return;
    const need = this.next + objs.length - 1;
    if (need > this.sheet.getMaxRows()) this.sheet.insertRowsAfter(this.sheet.getMaxRows(), need - this.sheet.getMaxRows() + 100);
    const range = this.sheet.getRange(this.next, 1, objs.length, this.headers.length);
    range.setNumberFormats(objs.map(o => this.headers.map(h => (NUMBER_COLS.has(h) ? numberFormat_(h, o[h]) : '@'))));
    range.setValues(objs.map(o => this.headers.map(h => (h ? writeCell_(h, o[h]) : ''))));
    objs.forEach((o, i) => this.rows.push(Object.assign({ _row: this.next + i }, o)));
    this.next += objs.length;
  }
  update(row, changes) {
    Object.assign(row, changes);
    this.sheet.getRange(row._row, 1, 1, this.headers.length).setValues([this.headers.map(h => (h ? writeCell_(h, row[h]) : ''))]);
  }
  find(col, val) { return this.rows.find(r => String(r[col]) === String(val)) || null; }
}

class Db {
  constructor() { this.ss = SpreadsheetApp.getActiveSpreadsheet(); this.t = {}; }
  table(name) { return this.t[name] || (this.t[name] = new Table(this.ss, name)); }
}

/* ============================================================================
 * Sales (bills) and payments
 *   Amount (per row) = Quantity × Price − Discount
 *   Bill total       = sum of Amount of its ACTIVE rows
 *   Received         = sum of Payments (refunds are negative), ignoring VOID
 *   Balance due      = Bill total − Received
 * ========================================================================== */
function bills_(db) {
  if (db._bills) return db._bills;
  const pays = groupBy_(db.table('Payments').rows.filter(x => x.Status !== 'VOID'), 'BillID');
  const lines = groupBy_(db.table('Sales').rows, 'BillID');
  const list = Object.keys(lines).map(id => {
    const all = lines[id], act = all.filter(l => l.Status === 'ACTIVE');
    const shown = act.length ? act : all.filter(l => l.Status === 'CANCELLED');
    const head = shown[0] || all[0];
    const totP = act.reduce((a, l) => a + paise_(l.Amount), 0);
    const subP = act.reduce((a, l) => a + Math.round(num_(l.Quantity) * num_(l.Price) * 100), 0);
    const recP = (pays[id] || []).reduce((a, x) => a + paise_(x.Amount), 0);
    const cancelled = !act.length;
    return {
      saleId: id, date: head.Date, customerName: head.Customer || WALKIN, notes: head.Notes,
      status: cancelled ? 'CANCELLED' : 'ACTIVE',
      subtotal: subP / 100, discount: (subP - totP) / 100, totalAmount: totP / 100,
      amountReceived: recP / 100, balanceDue: cancelled ? 0 : (totP - recP) / 100,
      paymentStatus: cancelled ? 'Cancelled' : totP <= 0 || recP >= totP ? 'Paid' : recP <= 0 ? 'Pending' : 'Partially Paid',
      products: shown.map(l => l.Product + ' × ' + num_(l.Quantity) + ' ' + l.Unit).join(', '),
      productIds: shown.map(l => l.Product), lines: all, firstRow: Math.min.apply(null, all.map(l => l._row))
    };
  });
  list.sort((a, b) => (b.date === a.date ? b.firstRow - a.firstRow : b.date.localeCompare(a.date)));
  db._bills = { list: list, byId: {} };
  list.forEach(b => { db._bills.byId[b.saleId] = b; });
  return db._bills;
}
function publicBill_(b) { const o = Object.assign({}, b); delete o.lines; delete o.firstRow; return o; }

/** Validates bill lines; returns rows ready for the Sales sheet (without BillID/Date/Customer). */
function buildLines_(items, discount) {
  if (!Array.isArray(items) || !items.length) fail_('VALIDATION_ERROR', 'Add at least one product.');
  if (items.length > 50) fail_('VALIDATION_ERROR', 'Too many lines on one bill.');
  const lines = items.map((it, i) => {
    const name = V.str(it && it.productId, 'Line ' + (i + 1) + ' product', { required: true, max: 80 });
    const unit = it.unit === 'Box' ? 'Box' : 'Piece';
    const qty = V.num(it.quantity, 'Line ' + (i + 1) + ' quantity', { positive: true, whole: true });
    const price = V.num(it.unitPrice, 'Line ' + (i + 1) + ' price');
    return { Product: name, Unit: unit, Quantity: qty, Price: price, Status: 'ACTIVE', _p: Math.round(qty * price * 100) };
  });
  const subP = lines.reduce((a, l) => a + l._p, 0);
  const discP = paise_(V.num(discount === '' || discount === undefined || discount === null ? 0 : discount, 'Discount'));
  if (discP > subP) fail_('VALIDATION_ERROR', 'Discount cannot be more than the subtotal.');
  // Share the bill discount across lines in proportion to their value; rounding goes to the biggest line.
  let given = 0, big = 0;
  lines.forEach((l, i) => { l._d = subP ? Math.floor(discP * l._p / subP) : 0; given += l._d; if (l._p > lines[big]._p) big = i; });
  lines[big]._d += discP - given;
  lines.forEach(l => { l.Discount = l._d / 100; l.Amount = (l._p - l._d) / 100; delete l._p; delete l._d; });
  return { lines: lines, totP: subP - discP };
}

function writeBill_(db, id, date, customer, notes, lines) {
  lines.forEach((l, i) => Object.assign(l, { BillID: id, Date: date, Customer: customer, Notes: i === 0 ? notes : '' }));
  db.table('Sales').append(lines);
}

function hSaveSale_(p, db) {
  const date = V.date(p.date, 'Sale date');
  const customer = V.str(p.customerName, 'Customer', { max: 80 }) || WALKIN;
  const notes = V.str(p.notes, 'Notes', { max: 300 });
  const b = buildLines_(p.items, p.discount);
  const recP = paise_(V.num(p.amountReceived === '' || p.amountReceived === undefined ? 0 : p.amountReceived, 'Amount received'));
  if (recP > b.totP) fail_('VALIDATION_ERROR', 'Amount received cannot be more than the bill total (₹' + (b.totP / 100).toFixed(2) + ').');
  const method = recP > 0 ? V.oneOf(p.paymentMethod || 'Cash', CONFIG.PAYMENT_METHODS, 'Payment method') : '';
  const id = newId_('BILL');
  writeBill_(db, id, date, customer, notes, b.lines);
  if (recP > 0) db.table('Payments').append([{ PaymentID: newId_('PAY'), BillID: id, Date: date, Amount: recP / 100, Method: method, Notes: V.str(p.paymentReference, 'Reference', { max: 60 }), Status: 'ACTIVE' }]);
  const bal = (b.totP - recP) / 100;
  return { message: 'Bill saved. Total ₹' + (b.totP / 100).toFixed(2) + ', balance due ₹' + bal.toFixed(2) + '.',
    data: { saleId: id, totalAmount: b.totP / 100, amountReceived: recP / 100, balanceDue: bal } };
}

function activeBill_(db, id) {
  const b = bills_(db).byId[id];
  if (!b) fail_('NOT_FOUND', 'Bill not found.');
  if (b.status === 'CANCELLED') fail_('CONFLICT', 'This bill is cancelled and cannot be changed.');
  return b;
}

function hUpdateSale_(p, db) {
  const b = activeBill_(db, p.saleId);
  const date = V.date(p.date, 'Sale date');
  const customer = V.str(p.customerName, 'Customer', { max: 80 }) || WALKIN;
  const notes = V.str(p.notes, 'Notes', { max: 300 });
  const old = b.lines.filter(l => l.Status === 'ACTIVE');
  const nb = buildLines_(p.items, p.discount);
  if (paise_(b.amountReceived) > nb.totP) fail_('CONFLICT', '₹' + b.amountReceived.toFixed(2) + ' was already received, which is more than the new total. Record a refund first.');
  const sales = db.table('Sales');
  old.forEach(l => sales.update(l, { Status: 'EDITED' }));    // old rows are kept, marked EDITED
  writeBill_(db, b.saleId, date, customer, notes, nb.lines);
  return { message: 'Bill updated.', data: { saleId: b.saleId, totalAmount: nb.totP / 100 } };
}

function hCancelSale_(p, db) {
  const b = activeBill_(db, p.saleId);
  const reason = V.str(p.reason, 'Reason', { required: true, max: 200 });
  const recP = paise_(b.amountReceived);
  if (recP > 0) {
    if (paise_(p.confirmReceived) !== recP) fail_('CONFLICT', 'The amount received has changed. Please reload and try again.');
    const how = V.oneOf(p.receivedHandling, ['REFUND', 'VOID_PAYMENTS'], 'Money received');
    const pt = db.table('Payments');
    if (how === 'REFUND') {
      pt.append([{ PaymentID: newId_('PAY'), BillID: b.saleId, Date: today_(), Amount: -recP / 100,
        Method: V.oneOf(p.refundMethod || 'Cash', CONFIG.PAYMENT_METHODS, 'Refund method'), Notes: 'Refund: ' + reason, Status: 'ACTIVE' }]);
    } else {
      pt.rows.filter(x => x.BillID === b.saleId && x.Status !== 'VOID').forEach(x => pt.update(x, { Status: 'VOID', Notes: (x.Notes ? x.Notes + ' | ' : '') + 'Void: ' + reason }));
    }
  }
  const sales = db.table('Sales'), act = b.lines.filter(l => l.Status === 'ACTIVE');
  act.forEach((l, i) => sales.update(l, i === 0 ? { Status: 'CANCELLED', Notes: (l.Notes ? l.Notes + ' | ' : '') + 'Cancelled: ' + reason } : { Status: 'CANCELLED' }));
  return { message: 'Bill cancelled.', data: { saleId: b.saleId } };
}

function hSavePayment_(p, db) {
  const b = activeBill_(db, p.saleId);
  const date = V.date(p.date, 'Payment date');
  if (date < b.date) fail_('VALIDATION_ERROR', 'Payment date cannot be before the bill date.');
  const refund = p.type === 'REFUND';
  const amtP = paise_(V.num(p.amount, 'Amount', { positive: true }));
  if (!refund && amtP > paise_(b.balanceDue)) fail_('VALIDATION_ERROR', 'Payment is more than the balance due (₹' + b.balanceDue.toFixed(2) + ').');
  if (refund && amtP > paise_(b.amountReceived)) fail_('VALIDATION_ERROR', 'Refund cannot be more than the amount received.');
  const id = newId_('PAY');
  db.table('Payments').append([{ PaymentID: id, BillID: b.saleId, Date: date, Amount: (refund ? -amtP : amtP) / 100,
    Method: V.oneOf(p.method, CONFIG.PAYMENT_METHODS, 'Method'), Notes: V.str((p.reference ? p.reference + ' ' : '') + (p.notes || ''), 'Notes', { max: 300 }), Status: 'ACTIVE' }]);
  const bal = (paise_(b.balanceDue) - (refund ? -amtP : amtP)) / 100;
  return { message: (refund ? 'Refund' : 'Payment') + ' saved. Balance due ₹' + bal.toFixed(2) + '.', data: { paymentId: id, balanceDue: bal } };
}

function hVoidPayment_(p, db) {
  const pt = db.table('Payments'), pay = pt.find('PaymentID', p.paymentId);
  if (!pay || pay.Status === 'VOID') fail_('NOT_FOUND', 'Payment not found or already voided.');
  const b = activeBill_(db, pay.BillID);
  const newRec = paise_(b.amountReceived) - paise_(pay.Amount);
  if (newRec < 0 || newRec > paise_(b.totalAmount)) fail_('CONFLICT', 'Voiding this would make the amount received wrong. Void the refund first.');
  pt.update(pay, { Status: 'VOID', Notes: (pay.Notes ? pay.Notes + ' | ' : '') + 'Void: ' + V.str(p.reason, 'Reason', { required: true, max: 200 }) });
  return { message: 'Payment voided.', data: {} };
}

function hGetSales_(p, db) {
  const r = V.range(p), q = String(p.q || '').toLowerCase().trim();
  const want = p.saleStatus || 'ACTIVE';
  const rows = bills_(db).list.filter(b => inRange_(b.date, r) && (want === 'ALL' || b.status === want)
    && (!p.productId || b.productIds.indexOf(p.productId) >= 0) && (!p.paymentStatus || b.paymentStatus === p.paymentStatus)
    && (!q || b.saleId.toLowerCase().indexOf(q) >= 0 || b.customerName.toLowerCase().indexOf(q) >= 0)).map(publicBill_);
  const act = rows.filter(b => b.status === 'ACTIVE'), sum = k => r2_(act.reduce((a, b) => a + b[k], 0));
  return { data: { rows: rows, range: r, totals: { count: act.length, totalAmount: sum('totalAmount'), amountReceived: sum('amountReceived'), balanceDue: sum('balanceDue') } } };
}

function hGetSale_(p, db) {
  const b = bills_(db).byId[p.saleId];
  if (!b) fail_('NOT_FOUND', 'Bill not found.');
  return { data: {
    sale: publicBill_(b),
    items: b.lines.map(l => ({ productId: l.Product, productName: l.Product, quantity: num_(l.Quantity), unit: l.Unit,
      unitPrice: r2_(l.Price), discount: r2_(l.Discount), lineTotal: r2_(l.Amount), status: l.Status })),
    payments: db.table('Payments').rows.filter(x => x.BillID === b.saleId).map(x => ({ paymentId: x.PaymentID, date: x.Date,
      amount: Math.abs(r2_(x.Amount)), type: num_(x.Amount) < 0 ? 'REFUND' : 'PAYMENT', method: x.Method, notes: x.Notes, status: x.Status || 'ACTIVE' }))
  } };
}

/* ---------- Customers (worked out from the Customer column of Sales) ---------- */
function hGetCustomers_(p, db) {
  const m = {};
  bills_(db).list.forEach(b => {
    const k = b.customerName.toLowerCase();
    const c = m[k] = m[k] || { customerName: b.customerName, salesCount: 0, totalPurchases: 0, totalPaid: 0, outstanding: 0, lastSaleDate: '' };
    if (b.status !== 'ACTIVE') return;
    c.salesCount++; c.totalPurchases = r2_(c.totalPurchases + b.totalAmount); c.totalPaid = r2_(c.totalPaid + b.amountReceived); c.outstanding = r2_(c.outstanding + b.balanceDue);
    if (b.date > c.lastSaleDate) c.lastSaleDate = b.date;
  });
  return { data: { customers: Object.keys(m).map(k => m[k]).sort((a, b) => (a.customerName === WALKIN ? -1 : b.customerName === WALKIN ? 1 : a.customerName.localeCompare(b.customerName))) } };
}

function hGetCustomerDetail_(p, db) {
  const name = String(p.customerId || '').toLowerCase();
  const sales = bills_(db).list.filter(b => b.customerName.toLowerCase() === name).map(publicBill_);
  if (!sales.length) fail_('NOT_FOUND', 'No bills for this customer.');
  const act = sales.filter(b => b.status === 'ACTIVE'), sum = k => r2_(act.reduce((a, b) => a + b[k], 0));
  return { data: { customer: { customerName: sales[0].customerName },
    summary: { salesCount: act.length, totalPurchases: sum('totalAmount'), totalPaid: sum('amountReceived'), outstanding: sum('balanceDue') }, sales: sales } };
}

/* ============================================================================
 * Expenses
 * ========================================================================== */
function expenseView_(x) {
  return { expenseId: x.ExpenseID, date: x.Date, category: x.Category, description: x.Description, amount: r2_(x.Amount),
    paymentMethod: x.Method, notes: x.Notes, status: x.Status || 'ACTIVE' };
}
function validateExpense_(p) {
  return { Date: V.date(p.date, 'Expense date'), Category: V.str(p.category, 'Category', { required: true, max: 60 }),
    Description: V.str(p.description, 'Description', { required: true, max: 200 }), Amount: V.num(p.amount, 'Amount', { positive: true }),
    Method: V.oneOf(p.paymentMethod, CONFIG.PAYMENT_METHODS, 'Paid by'), Notes: V.str(p.notes, 'Notes', { max: 300 }) };
}
function hSaveExpense_(p, db) {
  const d = validateExpense_(p), id = newId_('EXP');
  db.table('Expenses').append([Object.assign({ ExpenseID: id, Status: 'ACTIVE' }, d)]);
  return { message: 'Expense of ₹' + d.Amount.toFixed(2) + ' saved.', data: { expenseId: id } };
}
function hUpdateExpense_(p, db) {
  const t = db.table('Expenses'), row = t.find('ExpenseID', p.expenseId);
  if (!row || row.Status === 'VOID') fail_('NOT_FOUND', 'Expense not found or voided.');
  t.update(row, validateExpense_(p));
  return { message: 'Expense updated.', data: { expenseId: row.ExpenseID } };
}
function hVoidExpense_(p, db) {
  const t = db.table('Expenses'), row = t.find('ExpenseID', p.expenseId);
  if (!row || row.Status === 'VOID') fail_('NOT_FOUND', 'Expense not found or already voided.');
  t.update(row, { Status: 'VOID', Notes: (row.Notes ? row.Notes + ' | ' : '') + 'Void: ' + V.str(p.reason, 'Reason', { required: true, max: 200 }) });
  return { message: 'Expense voided.', data: {} };
}
function expenseSummary_(list) {
  const cat = {}, day = {}, mon = {};
  let t = 0;
  list.forEach(x => {
    const a = paise_(x.amount); t += a;
    cat[x.category] = (cat[x.category] || 0) + a; day[x.date] = (day[x.date] || 0) + a; mon[x.date.slice(0, 7)] = (mon[x.date.slice(0, 7)] || 0) + a;
  });
  const arr = (m, k) => Object.keys(m).sort().map(key => { const o = { amount: m[key] / 100 }; o[k] = key; return o; });
  return { total: t / 100, count: list.length,
    byCategory: Object.keys(cat).map(c => ({ category: c, amount: cat[c] / 100 })).sort((a, b) => b.amount - a.amount), daily: arr(day, 'date'), monthly: arr(mon, 'month') };
}
function activeExpenses_(db, r) { return db.table('Expenses').rows.map(expenseView_).filter(x => x.status !== 'VOID' && inRange_(x.date, r)); }

function hGetExpenses_(p, db) {
  const r = V.range(p), q = String(p.q || '').toLowerCase();
  const rows = db.table('Expenses').rows.map(expenseView_).filter(x => inRange_(x.date, r) && (!p.category || x.category === p.category)
    && (p.includeVoid || x.status !== 'VOID') && (!q || (x.description + ' ' + x.notes).toLowerCase().indexOf(q) >= 0)).reverse();
  return { data: { rows: rows, range: r, summary: expenseSummary_(rows.filter(x => x.status !== 'VOID')) } };
}

/* ============================================================================
 * Dashboard & reports
 *   Revenue        = bill totals of non-cancelled bills dated in the period (paid or not)
 *   Cash received  = payments − refunds dated in the period
 *   Expenses       = non-void expenses dated in the period
 *   Profit         = Revenue − Expenses   (no stock is tracked, so this is a simple estimate:
 *                    ingredients bought this month count this month, even if used later)
 *   Outstanding    = balance due on all non-cancelled bills
 * ========================================================================== */
function cashP_(db, r) {
  let inP = 0, outP = 0;
  db.table('Payments').rows.forEach(x => { if (x.Status === 'VOID' || !inRange_(x.Date, r)) return; const a = paise_(x.Amount); if (a < 0) outP -= a; else inP += a; });
  return { inP: inP, outP: outP };
}
function byProduct_(db, r) {
  const m = {};
  db.table('Sales').rows.forEach(l => {
    if (l.Status !== 'ACTIVE' || !inRange_(l.Date, r)) return;
    const o = m[l.Product] = m[l.Product] || { productName: l.Product, pieces: 0, boxes: 0, revP: 0 };
    if (l.Unit === 'Box') o.boxes += num_(l.Quantity); else o.pieces += num_(l.Quantity);
    o.revP += paise_(l.Amount);
  });
  return Object.keys(m).map(k => ({ productId: k, productName: k, pieces: m[k].pieces, boxes: m[k].boxes, revenue: m[k].revP / 100 })).sort((a, b) => b.revenue - a.revenue);
}
function series_(bills, from, to, monthly) {
  const m = {};
  bills.forEach(b => { if (b.date >= from && b.date <= to) { const k = monthly ? b.date.slice(0, 7) : b.date; const o = m[k] = m[k] || { p: 0, n: 0 }; o.p += paise_(b.totalAmount); o.n++; } });
  const out = [];
  if (monthly) for (let k = from.slice(0, 7); k <= to.slice(0, 7); k = addMonths_(k, 1)) out.push({ month: k, revenue: (m[k] ? m[k].p : 0) / 100, count: m[k] ? m[k].n : 0 });
  else for (let d = from; d <= to; d = addDays_(d, 1)) out.push({ date: d, revenue: (m[d] ? m[d].p : 0) / 100, count: m[d] ? m[d].n : 0 });
  return out;
}

function hGetDashboard_(p, db) {
  const r = V.range(p), t = today_();
  const bills = bills_(db).list.filter(b => b.status === 'ACTIVE');
  const inR = bills.filter(b => inRange_(b.date, r)), sum = arr => arr.reduce((a, b) => a + paise_(b.totalAmount), 0);
  const ex = expenseSummary_(activeExpenses_(db, r)), cash = cashP_(db, r);
  const due = bills.filter(b => b.balanceDue > 0);
  const chartFrom = addDays_(r.to, -365) > r.from ? addDays_(r.to, -365) : r.from;
  const pr = prevRange_(r), pInR = bills.filter(b => inRange_(b.date, pr)), pEx = expenseSummary_(activeExpenses_(db, pr));
  return { data: {
    range: r, today: t,
    metrics: {
      todayRevenue: sum(bills.filter(b => b.date === t)) / 100, monthRevenue: sum(bills.filter(b => b.date >= t.slice(0, 8) + '01' && b.date <= t)) / 100,
      revenue: sum(inR) / 100, transactions: inR.length, cashReceived: (cash.inP - cash.outP) / 100,
      totalExpenses: ex.total, profit: (sum(inR) - paise_(ex.total)) / 100,
      outstanding: due.reduce((a, b) => a + paise_(b.balanceDue), 0) / 100, outstandingCount: due.length,
      averageSale: inR.length ? r2_(sum(inR) / 100 / inR.length) : 0 },
    previous: { range: pr, revenue: sum(pInR) / 100, transactions: pInR.length, totalExpenses: pEx.total, profit: (sum(pInR) - paise_(pEx.total)) / 100,
      averageSale: pInR.length ? r2_(sum(pInR) / 100 / pInR.length) : 0 },
    charts: { daily: series_(bills, chartFrom, r.to, false), monthly: series_(bills, addMonths_(r.to.slice(0, 7), -11) + '-01', r.to, true), byProduct: byProduct_(db, r) },
    recentSales: bills_(db).list.filter(b => inRange_(b.date, r)).slice(0, 8).map(publicBill_),
    recentExpenses: activeExpenses_(db, r).reverse().slice(0, 8),
    dueBills: due.slice().sort((a, b) => b.balanceDue - a.balanceDue).slice(0, 8).map(publicBill_)
  } };
}

function hGetReports_(p, db) {
  const r = V.range(p), bills = bills_(db).list.filter(b => b.status === 'ACTIVE'), inR = bills.filter(b => inRange_(b.date, r));
  const revP = inR.reduce((a, b) => a + paise_(b.totalAmount), 0);
  const cust = {};
  inR.forEach(b => { const c = cust[b.customerName] = cust[b.customerName] || { customerName: b.customerName, transactions: 0, revenue: 0, outstanding: 0 }; c.transactions++; c.revenue = r2_(c.revenue + b.totalAmount); c.outstanding = r2_(c.outstanding + b.balanceDue); });
  const ex = expenseSummary_(activeExpenses_(db, r)), cash = cashP_(db, r);
  const byMethod = {};
  db.table('Payments').rows.forEach(x => { if (x.Status !== 'VOID' && inRange_(x.Date, r)) byMethod[x.Method] = (byMethod[x.Method] || 0) + paise_(x.Amount); });
  const open = bills.filter(b => b.balanceDue > 0 && b.date <= r.to).reverse().map(publicBill_);
  return { data: {
    range: r,
    sales: { totalRevenue: revP / 100, transactions: inR.length, averageSale: inR.length ? r2_(revP / 100 / inR.length) : 0, totalDiscount: r2_(inR.reduce((a, b) => a + b.discount, 0)),
      byProduct: byProduct_(db, r), byCustomer: Object.keys(cust).map(k => cust[k]).sort((a, b) => b.revenue - a.revenue),
      daily: series_(bills, r.from, r.to, false).filter(d => d.count), monthly: series_(bills, r.from, r.to, true) },
    insights: insights_(db, r, bills),
    expenses: ex,
    payments: { received: cash.inP / 100, refunded: cash.outP / 100, netReceived: (cash.inP - cash.outP) / 100,
      byMethod: Object.keys(byMethod).map(k => ({ method: k, amount: byMethod[k] / 100 })), outstandingTotal: r2_(open.reduce((a, b) => a + b.balanceDue, 0)),
      partiallyPaid: open.filter(b => b.paymentStatus === 'Partially Paid'), pending: open.filter(b => b.paymentStatus === 'Pending') },
    profit: { revenue: revP / 100, expenses: ex.total, profit: (revP - paise_(ex.total)) / 100,
      cashIn: (cash.inP - cash.outP) / 100, cashOut: ex.total, netCashFlow: (cash.inP - cash.outP - paise_(ex.total)) / 100,
      method: ['Revenue = total of non-cancelled bills dated in the period, after discounts (includes unpaid bills).',
        'Expenses = all expenses dated in the period (ingredients, packing, transport, electricity…).',
        'Profit = Revenue − Expenses. Stock is not tracked, so ingredients bought in one month and used in the next are counted in the month they were bought.',
        'Cash view = payments received − refunds − expenses paid in the period.'] }
  } };
}

/** The same number of days just before the chosen period (e.g. this month ↔ the days before it). */
function prevRange_(r) {
  const days = Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86400000) + 1;
  return { from: addDays_(r.from, -days), to: addDays_(r.from, -1), days: days };
}
function weekday_(ymd) { const p = ymd.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); }

/** Insights tab: this period vs the one before, item performance, best days, customers to follow up. */
function insights_(db, r, bills) {
  const pr = prevRange_(r);
  const totals = range => {
    const inR = bills.filter(b => inRange_(b.date, range)), revP = inR.reduce((a, b) => a + paise_(b.totalAmount), 0);
    const exP = paise_(expenseSummary_(activeExpenses_(db, range)).total), c = cashP_(db, range);
    return { revenue: revP / 100, transactions: inR.length, averageSale: inR.length ? r2_(revP / 100 / inR.length) : 0, expenses: exP / 100,
      profit: (revP - exP) / 100, margin: revP ? Math.round((revP - exP) / revP * 1000) / 10 : null, cashReceived: (c.inP - c.outP) / 100,
      customers: Object.keys(groupBy_(inR.filter(b => b.customerName !== WALKIN), 'customerName')).length };
  };
  // items: pieces sold counting a box as BOX_SIZE pieces
  const items = range => {
    const m = {};
    db.table('Sales').rows.forEach(l => {
      if (l.Status !== 'ACTIVE' || !inRange_(l.Date, range)) return;
      const o = m[l.Product] = m[l.Product] || { productName: l.Product, pieces: 0, revP: 0, bills: {} };
      o.pieces += num_(l.Quantity) * (l.Unit === 'Box' ? CONFIG.BOX_SIZE : 1); o.revP += paise_(l.Amount); o.bills[l.BillID] = 1;
    });
    return m;
  };
  const cur = items(r), prev = items(pr), revAll = Object.keys(cur).reduce((a, k) => a + cur[k].revP, 0);
  const itemRows = Object.keys(cur).map(k => ({ productName: k, pieces: cur[k].pieces, revenue: cur[k].revP / 100, bills: Object.keys(cur[k].bills).length,
    share: revAll ? Math.round(cur[k].revP / revAll * 1000) / 10 : 0, perPiece: cur[k].pieces ? r2_(cur[k].revP / 100 / cur[k].pieces) : 0,
    previousRevenue: prev[k] ? prev[k].revP / 100 : 0 })).sort((a, b) => b.revenue - a.revenue);
  // weekdays
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], wd = names.map(n => ({ day: n, revenue: 0, transactions: 0 }));
  bills.filter(b => inRange_(b.date, r)).forEach(b => { const o = wd[weekday_(b.date)]; o.revenue = r2_(o.revenue + b.totalAmount); o.transactions++; });
  const weekdays = wd.slice(1).concat(wd[0]);
  // customers: new vs returning, and regulars who have not ordered for a while
  const byCust = {};
  bills.forEach(b => { const c = byCust[b.customerName] = byCust[b.customerName] || { customerName: b.customerName, first: b.date, last: b.date, bills: 0, revenue: 0, dates: [] };
    c.first = b.date < c.first ? b.date : c.first; c.last = b.date > c.last ? b.date : c.last; c.bills++; c.revenue = r2_(c.revenue + b.totalAmount); c.dates.push(b.date); });
  const named = Object.keys(byCust).map(k => byCust[k]).filter(c => c.customerName !== WALKIN);
  const active = named.filter(c => c.dates.some(d => inRange_(d, r)));
  const newOnes = active.filter(c => inRange_(c.first, r));
  const followUp = named.filter(c => c.bills >= 2 && c.last < addDays_(r.to, -30)).map(c => {
    const ds = c.dates.slice().sort(), gaps = ds.slice(1).map((d, i) => (Date.parse(d) - Date.parse(ds[i])) / 86400000);
    return { customerName: c.customerName, lastDate: c.last, daysSince: Math.round((Date.parse(r.to) - Date.parse(c.last)) / 86400000), bills: c.bills, revenue: c.revenue,
      usualGap: gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null };
  }).sort((a, b) => b.revenue - a.revenue).slice(0, 15);
  const inPeriod = bills.filter(b => inRange_(b.date, r)), perCust = {};
  inPeriod.forEach(b => { if (b.customerName !== WALKIN) perCust[b.customerName] = (perCust[b.customerName] || 0) + paise_(b.totalAmount); });
  const topRev = Object.keys(perCust).map(k => perCust[k]).sort((x, y) => y - x);
  const periodRev = inPeriod.reduce((a, b) => a + paise_(b.totalAmount), 0);
  return { current: totals(r), previous: totals(pr), previousRange: pr, items: itemRows, weekdays: weekdays,
    customers: { active: active.length, newCount: newOnes.length, returning: active.length - newOnes.length, newNames: newOnes.map(c => c.customerName).slice(0, 20),
      top3Share: periodRev ? Math.round(topRev.slice(0, 3).reduce((a, b) => a + b, 0) / periodRev * 1000) / 10 : 0 },
    followUp: followUp };
}

/* ---------- Export, bootstrap, data check ---------- */
function hExportData_(p, db) {
  const name = V.oneOf(p.entity, Object.keys(SHEETS), 'Sheet');
  return { data: { entity: name, headers: SHEETS[name], rows: db.table(name).rows.map(r => SHEETS[name].map(h => (r[h] === undefined ? '' : r[h]))) } };
}

function hGetBootstrap_(p, db) {
  return { data: { customers: hGetCustomers_(p, db).data.customers, today: today_(), version: CONFIG.VERSION,
    settings: { businessName: CONFIG.BUSINESS_NAME, paymentMethods: CONFIG.PAYMENT_METHODS, defaultPaymentMethod: CONFIG.PAYMENT_METHODS[0],
      expenseCategories: mergeNames_(CONFIG.EXPENSE_CATEGORIES, db.table('Expenses').rows.map(r => r.Category)) },
    usedProducts: mergeNames_([], db.table('Sales').rows.map(r => r.Product)) } };
}

/** The fixed list first, then any other names already typed in the sheet (new categories / items added on the spot). */
function mergeNames_(base, more) {
  const seen = {}, out = [];
  base.concat(more).forEach(v => { const t = String(v === null || v === undefined ? '' : v).trim(); const k = t.toLowerCase();
    if (t && !seen[k]) { seen[k] = 1; out.push(t); } });
  return out;
}

/** Finds overpaid bills and payments that point to a bill that does not exist. */
function hCheckData_(p, db) {
  const issues = [], ids = bills_(db).byId;
  bills_(db).list.forEach(b => { if (b.status === 'ACTIVE' && b.balanceDue < 0) issues.push('Bill ' + b.saleId + ' is overpaid by ₹' + (-b.balanceDue).toFixed(2) + '.'); });
  db.table('Payments').rows.forEach(x => { if (!ids[x.BillID]) issues.push('Payment ' + x.PaymentID + ' points to unknown bill ' + x.BillID + '.'); });
  return { message: issues.length ? issues.length + ' problem(s) found.' : 'Everything matches.',
    data: { issues: issues, counts: Object.keys(SHEETS).reduce((o, n) => { o[n] = db.table(n).rows.length; return o; }, {}) } };
}

/** All rows of the 3 tabs, already cleaned (numbers as numbers, dates as yyyy-MM-dd). The website works on this copy. */
function snapshot_(db) {
  const tables = {};
  Object.keys(SHEETS).forEach(name => {
    tables[name] = { headers: SHEETS[name], rows: db.table(name).rows.map(r => SHEETS[name].map(h => (r[h] === undefined || r[h] === null ? '' : r[h]))) };
  });
  return { version: CONFIG.VERSION, today: today_(), tables: tables };
}

const ROUTES = {
  getSnapshot: { fn: (p, db) => ({ data: snapshot_(db) }) },
  ping: { fn: () => ({ message: 'Connected', data: { version: CONFIG.VERSION, serverDate: today_() } }) },
  getBootstrap: { fn: hGetBootstrap_ }, getDashboard: { fn: hGetDashboard_ }, getSales: { fn: hGetSales_ }, getSale: { fn: hGetSale_ },
  getCustomers: { fn: hGetCustomers_ }, getCustomerDetail: { fn: hGetCustomerDetail_ }, getExpenses: { fn: hGetExpenses_ },
  getReports: { fn: hGetReports_ }, exportData: { fn: hExportData_ }, checkData: { fn: hCheckData_ },
  saveSale: { write: true, fn: hSaveSale_ }, updateSale: { write: true, fn: hUpdateSale_ }, cancelSale: { write: true, fn: hCancelSale_ },
  savePayment: { write: true, fn: hSavePayment_ }, voidPayment: { write: true, fn: hVoidPayment_ },
  saveExpense: { write: true, fn: hSaveExpense_ }, updateExpense: { write: true, fn: hUpdateExpense_ }, voidExpense: { write: true, fn: hVoidExpense_ }
};

/* ============================================================================
 * SELF-TEST — run this from the Apps Script editor (choose testBackend → Run,
 * then View → Logs / Execution log). It reads your sheet exactly like the website
 * does, so you can see whether the data is found, without the website.
 * ========================================================================== */
/**
 * Run ONCE from the Apps Script editor (choose tidySheet → Run) after pasting or typing rows by hand.
 *  • removes the drop-down "chips" from Product and the number columns (they cause the red corner warnings)
 *  • turns text like "₹16.00" or "-" into real numbers (16, 0) so the sheet can add them up
 *  • shows all money as ₹1,280.00 and quantities as plain numbers
 * Nothing is deleted; the values stay the same.
 */
function tidySheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const noChips = { Sales: ['Product', 'Quantity', 'Price', 'Discount', 'Amount'], Payments: ['Amount'], Expenses: ['Category', 'Amount'] };
  const log = [];
  Object.keys(SHEETS).forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    const vals = sh.getDataRange().getValues();
    const head = (vals[0] || []).map(h => String(h).trim());
    const rows = vals.length - 1;
    head.forEach((h, j) => {
      if (noChips[name].indexOf(h) >= 0) sh.getRange(2, j + 1, sh.getMaxRows() - 1, 1).clearDataValidations();   // whole column, incl. future rows
      if (!NUMBER_COLS.has(h) || rows < 1) return;
      let changed = 0;
      const col = vals.slice(1).map(r => {
        const v = r[j];
        if (v === '' || v === null) return [''];
        const n = money_(v);
        if (n !== v) changed++;
        return [n];
      });
      const range = sh.getRange(2, j + 1, rows, 1);
      range.setValues(col);
      range.setNumberFormats(col.map(c => [numberFormat_(h, c[0])]));
      log.push(name + ' · ' + h + ': ' + changed + ' text value(s) turned into numbers');
    });
  });
  SpreadsheetApp.flush();
  console.log(log.join('\n') || 'Nothing to tidy.');
  return log;
}

function testBackend() {
  const ask = (action, payload) => handleRequest_({ parameter: { payload: JSON.stringify({ action: action, payload: payload || {} }) } });
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  console.log('Spreadsheet: ' + ss.getName() + ' | tabs: ' + ss.getSheets().map(s => s.getName()).join(', '));
  Object.keys(SHEETS).forEach(n => {
    const sh = ss.getSheetByName(n);
    console.log(n + ': ' + (sh ? (sh.getLastRow() - 1) + ' data rows, headers = ' + sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].join(' | ') : 'MISSING TAB'));
  });
  const d = ask('getDashboard', { from: '2000-01-01', to: today_() });
  console.log(d.success ? 'Dashboard (all dates): ' + JSON.stringify(d.data.metrics) : 'Dashboard FAILED: ' + d.message);
  console.log('If the numbers above are correct, the backend is fine and the problem is the deployment (access must be "Anyone", deploy a New version, link must end in /exec).');
}

      return { handleRequest_: handleRequest_, version: CONFIG.VERSION };
    })(__m.SpreadsheetApp, __m.Utilities, __m.CacheService, __m.PropertiesService, __m.LockService, __m.ContentService, __m.console);
    const ss = __m.SpreadsheetApp.getActiveSpreadsheet();
    return {
      version: api.version,
      load: function (snap) {
        Object.keys(snap.tables).forEach(function (name) {
          const t = snap.tables[name];
          const sh = ss.getSheetByName(name) || ss.insertSheet(name);
          sh.data = [t.headers.slice()].concat(t.rows.map(function (r) { return r.slice(); }));
          sh.maxRows = Math.max(1000, sh.data.length + 100);
          sh.maxCols = Math.max(26, t.headers.length);
        });
      },
      call: function (action, payload) {
        return api.handleRequest_({ parameter: { payload: JSON.stringify({ action: action, payload: payload || {}, requestId: '' }) } });
      }
    };
  }
};