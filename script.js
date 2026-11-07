/* =============================================================================
 * Millet Laddoo Business Manager — frontend logic (script.js)
 * Simple version 3.0 (no login, no stock tracking). Plain ES2020, no framework. Sections:
 *   1. Utilities & formatting       5. Router & app shell
 *   2. Storage                      6. Shared widgets (tables, pager, tabs, CSV)
 *   3. API client                   7. Page controllers
 *   4. UI: toasts, dialogs, forms   8. Start-up
 * The server (Code.gs) recalculates every total and payment status; the
 * numbers calculated here are only previews for the person typing.
 * ============================================================================= */
(() => {
  'use strict';

  const CFG = window.LADDOO_CONFIG || {};
  const DEMO = !!window.LADDOO_DEMO_TRANSPORT;

  /* ===================== 1. Utilities & formatting ===================== */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uuid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
    : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const toPaise = (n) => Math.round((Number(n) || 0) * 100);
  const numOrBlank = (v) => (v === '' || v === null || v === undefined ? '' : Number(v));

  const moneyFmt = new Intl.NumberFormat(CFG.LOCALE || 'en-IN', { style: 'currency', currency: CFG.CURRENCY || 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const moneyShort = new Intl.NumberFormat(CFG.LOCALE || 'en-IN', { style: 'currency', currency: CFG.CURRENCY || 'INR', maximumFractionDigits: 0 });
  const qtyFmt = new Intl.NumberFormat(CFG.LOCALE || 'en-IN', { maximumFractionDigits: 3 });

  const Fmt = {
    inr: (n) => moneyFmt.format(Number(n) || 0),
    inrShort: (n) => moneyShort.format(Number(n) || 0),
    qty: (n) => qtyFmt.format(Number(n) || 0),
    date(ymd) {
      if (!ymd) return '';
      const p = String(ymd).slice(0, 10).split('-');
      return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : String(ymd);
    },
    dateTime(iso) {
      if (!iso) return '';
      const s = String(iso);
      return Fmt.date(s.slice(0, 10)) + (s.length > 15 ? ' ' + s.slice(11, 16) : '');
    },
    month(ym) {
      const [y, m] = String(ym).split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    },
    statusPill(status) {
      const cls = { 'Paid': 'paid', 'Partially Paid': 'partial', 'Pending': 'pending', 'Cancelled': 'cancelled' }[status] || '';
      return `<span class="pill ${cls}">${esc(status)}</span>`;
    }
  };

  const Dates = {
    today() {
      return new Intl.DateTimeFormat('en-CA', { timeZone: CFG.TIMEZONE || 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    },
    add(ymd, n) {
      const [y, m, d] = ymd.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
    },
    monthStart: (ymd) => ymd.slice(0, 8) + '01',
    long(ymd) {
      const [y, m, d] = ymd.split('-').map(Number);
      const wd = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' });
      return `${wd}, ${Fmt.date(ymd)}`;
    },
    preset(name) {
      const t = Dates.today();
      switch (name) {
        case 'today': return { from: t, to: t };
        case '7d': return { from: Dates.add(t, -6), to: t };
        case '30d': return { from: Dates.add(t, -29), to: t };
        case 'year': return { from: t.slice(0, 4) + '-01-01', to: t };
        case 'lastmonth': {
          const end = Dates.add(Dates.monthStart(t), -1);
          return { from: Dates.monthStart(end), to: end };
        }
        default: return { from: Dates.monthStart(t), to: t };
      }
    },
    valid(ymd) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return false;
      const [y, m, d] = ymd.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 2000 && y <= 2100;
    }
  };

  /* ===================== 2. Storage & session ===================== */
  const Store = {
    get(area, key) { try { return window[area].getItem(key); } catch (e) { return null; } },
    set(area, key, val) { try { window[area].setItem(key, val); } catch (e) { /* storage unavailable */ } },
    del(area, key) { try { window[area].removeItem(key); } catch (e) { /* ignore */ } }
  };
  /* ===================== 3. API client =====================
   * Transport: POST with a URL-encoded body  payload=<JSON>  and no custom
   * headers → a CORS "simple request" that Apps Script can answer. The
   * response is read after fetch follows Apps Script's 302 redirect.
   * Write actions carry a requestId that is reused on retry, so the server
   * never applies the same entry twice.
   * ========================================================= */
  class ApiError extends Error { constructor(code, message) { super(message); this.code = code; this.isApi = true; } }

  const Loading = {
    count: 0,
    start() { this.count++; $('#loading-bar').hidden = false; },
    stop() { this.count = Math.max(0, this.count - 1); if (!this.count) $('#loading-bar').hidden = true; }
  };

  const Api = {
    configured() { return DEMO || (typeof CFG.API_URL === 'string' && /^https:\/\/script\.google(usercontent)?\.com\//.test(CFG.API_URL)); },
    async call(action, payload = {}, opts = {}) {
      const envelope = { action, payload, requestId: opts.requestId || '', clientVersion: CFG.CLIENT_VERSION || '' };
      Loading.start();
      try {
        const res = DEMO ? await window.LADDOO_DEMO_TRANSPORT(envelope) : await Api.http(envelope);
        if (!res || typeof res.success !== 'boolean') throw new ApiError('BAD_RESPONSE', 'The server sent an unexpected reply.');
        if (!res.success) {
          const err = new ApiError(res.code || 'SERVER_ERROR', res.message || 'The request failed.');
          throw err;
        }
        return res;
      } finally {
        Loading.stop();
      }
    },
    async http(envelope) {
      if (!Api.configured()) throw new ApiError('NOT_CONFIGURED', 'The web app address is not set. Paste your Apps Script web app URL into API_URL in config.js.');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), CFG.REQUEST_TIMEOUT_MS || 30000);
      try {
        const resp = await fetch(CFG.API_URL, {
          method: 'POST',
          body: new URLSearchParams({ payload: JSON.stringify(envelope) }),
          redirect: 'follow', cache: 'no-store', credentials: 'omit', signal: ctrl.signal
        });
        const text = await resp.text();
        try { return JSON.parse(text); } catch (e) {
          throw new ApiError('BAD_RESPONSE', 'The server reply was not readable. Check that the Apps Script web app is deployed with "Who has access: Anyone" and that API_URL ends with /exec.');
        }
      } catch (e) {
        if (e.isApi) throw e;
        if (e.name === 'AbortError') throw new ApiError('TIMEOUT', 'The server took too long to answer, so the result is unknown. Press the button again to retry: the entry will not be saved twice.');
        throw new ApiError('NETWORK_ERROR', 'Could not reach the server. Check your internet connection and try again.');
      } finally {
        clearTimeout(timer);
      }
    }
  };

  /* ===================== 4. UI: toasts, dialogs, forms ===================== */
  const UI = {
    toast(message, type = 'success', ms) {
      const root = $('#toast-root');
      const el = document.createElement('div');
      el.className = 'toast ' + (type === 'success' ? '' : type);
      el.setAttribute('role', type === 'error' ? 'alert' : 'status');
      el.innerHTML = `<div class="msg">${esc(message)}</div><button type="button" aria-label="Dismiss"><svg><use href="#i-x"/></svg></button>`;
      $('button', el).addEventListener('click', () => el.remove());
      root.appendChild(el);
      while (root.children.length > 4) root.firstElementChild.remove();
      setTimeout(() => el.remove(), ms || (type === 'error' ? 9000 : 4500));
    },
    open(id) {
      const d = document.getElementById(id);
      if (!d.open) d.showModal();
      const first = $('input:not([type=hidden]):not([readonly]), select, textarea', d);
      if (first && window.matchMedia('(min-width: 681px)').matches) first.focus();
      return d;
    },
    close(id) { const d = document.getElementById(id); if (d && d.open) d.close(); },
    setBusy(btn, busy) {
      if (!btn) return;
      btn.disabled = busy;
      if (busy) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
    },
    formError(form, message) {
      const el = $('.form-error', form);
      if (!el) { if (message) UI.toast(message, 'error'); return; }
      el.textContent = message || '';
      el.hidden = !message;
    },
    clearInvalid(form) {
      $$('[aria-invalid="true"]', form).forEach((i) => i.removeAttribute('aria-invalid'));
      $$('.field-error', form).forEach((e) => e.remove());
      UI.formError(form, '');
    },
    invalid(input, message) {
      input.setAttribute('aria-invalid', 'true');
      const field = input.closest('.field') || input.parentElement;
      if (field && !$('.field-error', field)) {
        const m = document.createElement('span');
        m.className = 'field-error'; m.textContent = message;
        field.appendChild(m);
      }
    },
    /** Ask for confirmation (and optionally a reason). Resolves to the reason string ('' if none needed) or null. */
    confirm({ title, message, okLabel = 'Confirm', needReason = false, danger = true }) {
      return new Promise((resolve) => {
        const d = $('#dlg-reason'), form = $('#form-reason');
        $('#dlg-reason-title').textContent = title;
        $('#reason-message').textContent = message;
        $('#reason-field').hidden = !needReason;
        $('#reason-input').value = '';
        const ok = $('#reason-ok');
        ok.textContent = okLabel;
        ok.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
        UI.clearInvalid(form);
        let done = false;
        const finish = (val) => { if (done) return; done = true; form.removeEventListener('submit', onSubmit); d.removeEventListener('close', onClose); UI.close('dlg-reason'); resolve(val); };
        const onSubmit = (e) => {
          e.preventDefault();
          const reason = $('#reason-input').value.trim();
          if (needReason && !reason) { UI.invalid($('#reason-input'), 'Please give a short reason.'); return; }
          finish(reason);
        };
        const onClose = () => finish(null);
        form.addEventListener('submit', onSubmit);
        d.addEventListener('close', onClose);
        UI.open('dlg-reason');
      });
    },
    empty(title, sub) {
      return `<div class="empty"><svg><use href="#i-box"/></svg><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>`;
    },
    loadingBlock() { return '<div class="skeleton" style="width:60%"></div><div class="skeleton"></div><div class="skeleton" style="width:80%"></div>'; },
    errorBlock(err) { return `<div class="notice notice-warn">${esc(err && err.message ? err.message : 'Could not load this section.')}</div>`; }
  };

  /** Read a form into an object (checkboxes → booleans). */
  function formData(form) {
    const o = {};
    $$('input[name], select[name], textarea[name]', form).forEach((el) => {
      if (el.type === 'checkbox') o[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
      else o[el.name] = el.value.trim();
    });
    return o;
  }
  function setForm(form, data) {
    Object.keys(data).forEach((k) => {
      const el = form.elements[k];
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!data[k];
      else el.value = data[k] === undefined || data[k] === null ? '' : data[k];
    });
  }

  /**
   * Run a write action from a form. Prevents double submission (button disabled
   * + in-flight flag) and keeps the same requestId until the server confirms
   * success, so a retry after a timeout can never create a duplicate.
   */
  async function submitWrite(form, action, payload, onSuccess) {
    if (form.dataset.busy === '1') return null;
    if (!form.dataset.requestId) form.dataset.requestId = uuid();
    const btns = $$('button[type="submit"]', form);
    form.dataset.busy = '1';
    btns.forEach((b) => UI.setBusy(b, true));
    UI.formError(form, '');
    try {
      const res = await Api.call(action, payload, { requestId: form.dataset.requestId });
      form.dataset.requestId = '';
      UI.toast(res.message || 'Saved.');
      if (onSuccess) await onSuccess(res.data || {});
      return res;
    } catch (err) {
      UI.formError(form, err.message);
      if (['TIMEOUT', 'NETWORK_ERROR', 'BUSY', 'SERVER_ERROR'].includes(err.code)) UI.toast(err.message, 'warn');
      return null;
    } finally {
      form.dataset.busy = '';
      btns.forEach((b) => UI.setBusy(b, false));
    }
  }
  function freshRequest(form) { form.dataset.requestId = uuid(); }

  /** Simple client-side checks; the server repeats every check. */
  function validate(form, rules) {
    UI.clearInvalid(form);
    let ok = true;
    rules.forEach(([name, test, msg]) => {
      const el = form.elements[name];
      if (!el) return;
      if (!test(el.value.trim(), el)) { ok = false; UI.invalid(el, msg); }
    });
    if (!ok) {
      UI.formError(form, 'Please correct the highlighted fields.');
      const firstBad = $('[aria-invalid="true"]', form);
      if (firstBad) firstBad.focus();
    }
    return ok;
  }
  const R = {
    required: (v) => v !== '',
    date: (v) => Dates.valid(v),
    notFuture: (v) => Dates.valid(v) && v <= Dates.today(),
    pos: (v) => v !== '' && isFinite(v) && Number(v) > 0,
    nonNeg: (v) => v !== '' && isFinite(v) && Number(v) >= 0,
    optNonNeg: (v) => v === '' || (isFinite(v) && Number(v) >= 0),
    money: (v) => v !== '' && isFinite(v) && Number(v) >= 0 && Math.abs(Number(v) * 100 - Math.round(Number(v) * 100)) < 1e-6
  };

  /* ===================== 5. Shared state, router & app shell ===================== */
  /** Items for the Record Sale drop-down come from config.js, so they show even without a connection. */
  const CONFIG_PRODUCTS = (CFG.PRODUCTS || []).map((p) => {
    const box = Number(p.boxSize) || 0, piece = Number(p.pricePerPiece) || 0;
    return { productId: p.name, productName: p.name, sellingPrice: piece, boxSize: box || '',
      boxPrice: box ? (Number(p.pricePerBox) || box * piece) : '', active: true };
  });
  const DEFAULT_SETTINGS = { businessName: '', paymentMethods: ['Cash', 'UPI', 'Bank transfer', 'Other'], defaultPaymentMethod: 'Cash',
    expenseCategories: ['Millet', 'Ragi', 'Jaggery', 'Nuts', 'Oil or ghee', 'Raw materials', 'Packaging materials', 'Aluminium foil', 'Boxes and labels', 'Transportation', 'Electricity', 'Other expenses'] };
  /** Items / categories added on the spot ("+ Add new…"). Kept in this browser, and the server also
   *  sends back every name already used in the sheet, so they show on other phones once used in a bill or expense. */
  const ADD_NEW = '__add_new__';
  const newProduct = (name) => ({ productId: name, productName: name, sellingPrice: 0, boxSize: 8, boxPrice: 0, active: true });
  const Extras = {
    KEY: 'laddoo_extras',
    get() { try { const x = JSON.parse(localStorage.getItem(Extras.KEY) || '{}'); return { products: x.products || [], categories: x.categories || [] }; } catch (e) { return { products: [], categories: [] }; } },
    add(kind, name) { const x = Extras.get(); if (!x[kind].includes(name)) x[kind].push(name); try { localStorage.setItem(Extras.KEY, JSON.stringify(x)); } catch (e) { /* private window: kept until reload */ } }
  };
  const hasName = (list, name) => list.some((n) => n.toLowerCase() === name.toLowerCase());
  function mergeProducts(names) {
    names.forEach((n) => { n = String(n || '').trim(); if (n && !hasName(State.products.map((p) => p.productName), n)) State.products.push(newProduct(n)); });
  }
  function mergeCategories(names) {
    names.forEach((n) => { n = String(n || '').trim(); if (n && !hasName(State.settings.expenseCategories, n)) State.settings.expenseCategories.push(n); });
  }
  const State = { settings: { ...DEFAULT_SETTINGS, expenseCategories: DEFAULT_SETTINGS.expenseCategories.slice() }, products: CONFIG_PRODUCTS.slice(), customers: [], loaded: false };
  mergeProducts(Extras.get().products); mergeCategories(Extras.get().categories);
  const productById = (id) => State.products.find((p) => p.productId === id);
  const customerById = (id) => State.customers.find((c) => c.customerId === id);

  /** "+ Add new…" at the bottom of a drop-down: shows a small box to type the name right there. */
  const AddNew = {
    // remember what was selected before the user picked "+ Add new…", so Cancel can put it back
    track() { document.addEventListener('focusin', (e) => { if (e.target.tagName === 'SELECT' && e.target.value !== ADD_NEW) e.target.dataset.prev = e.target.value; }); },
    start(sel, kind) {
      const prev = sel.dataset.prev && [...sel.options].some((o) => o.value === sel.dataset.prev) ? sel.dataset.prev : (kind === 'products' ? '' : sel.options[0].value);
      sel.value = prev;
      const field = sel.closest('.sale-line') || sel.closest('.field');   // on a bill line the box takes a full row below
      let box = $('.add-new', field);
      if (!box) {
        box = document.createElement('div');
        box.className = 'add-new';
        box.innerHTML = `<input type="text" maxlength="60" aria-label="${kind === 'products' ? 'New item name' : 'New category name'}" placeholder="${kind === 'products' ? 'New item name' : 'New category name'}">
          <button type="button" class="btn btn-primary btn-sm" data-add>Add</button>
          <button type="button" class="icon-btn" data-cancel aria-label="Cancel" title="Cancel"><svg><use href="#i-x"/></svg></button>`;
        field.appendChild(box);
        const input = $('input', box);
        const close = () => { box.remove(); sel.focus(); };
        const add = () => {
          const name = input.value.trim().replace(/\s+/g, ' ');
          if (!name) { input.focus(); input.setAttribute('aria-invalid', 'true'); return; }
          const existing = kind === 'products' ? (State.products.find((p) => p.productName.toLowerCase() === name.toLowerCase()) || {}).productId
            : State.settings.expenseCategories.find((c) => c.toLowerCase() === name.toLowerCase());
          let value = existing;
          if (!existing) {
            Extras.add(kind, name);
            if (kind === 'products') { mergeProducts([name]); Selects.products(); }
            else { mergeCategories([name]); Selects.keep($('#ex-category'), Selects.options(State.settings.expenseCategories, { blank: 'All categories' }));
              Selects.keep(sel, Selects.options(State.settings.expenseCategories, { addNew: '+ Add new category…' })); }
            value = name;
          }
          sel.value = value; sel.dataset.prev = value;
          box.remove();
          sel.dispatchEvent(new Event('change', { bubbles: true }));   // fills unit / quantity for a new item
          UI.toast(existing ? `"${value}" is already in the list – selected it.` : `Added "${value}".`);
        };
        $('[data-add]', box).addEventListener('click', add);
        $('[data-cancel]', box).addEventListener('click', close);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); add(); }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        });
        input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
      }
      $('input', box).focus();
    }
  };

  async function loadCore() {
    const res = await Api.call('getBootstrap');
    State.settings = res.data.settings;
    mergeCategories(DEFAULT_SETTINGS.expenseCategories.concat(Extras.get().categories));
    mergeProducts((res.data.usedProducts || []).concat(Extras.get().products));
    State.customers = res.data.customers;
    State.loaded = true;
    Selects.fillAll();
    $('#sidebar-business').textContent = State.settings.businessName;
    return res.data;
  }

  const Selects = {
    options(list, { value = (x) => x, label = (x) => x, blank, addNew } = {}) {
      return (blank !== undefined ? `<option value="">${esc(blank)}</option>` : '') +
        list.map((x) => `<option value="${esc(value(x))}">${esc(label(x))}</option>`).join('') +
        (addNew ? `<option value="${ADD_NEW}">${esc(addNew)}</option>` : '');
    },
    keep(sel, html) { const v = sel.value; sel.innerHTML = html; if ([...sel.options].some((o) => o.value === v)) sel.value = v; },
    fillAll() {
      const s = State.settings;
      Selects.keep($('#sh-product'), Selects.options(State.products, { value: (p) => p.productId, label: (p) => p.productName, blank: 'All products' }));
      Selects.keep($('#ex-category'), Selects.options(s.expenseCategories, { blank: 'All categories' }));
      Selects.keep($('#e-cat'), Selects.options(s.expenseCategories, { addNew: '+ Add new category…' }));
      const methods = Selects.options(s.paymentMethods);
      ['#sale-method', '#pay-method', '#e-method', '#cancel-refund-method'].forEach((id) => {
        const el = $(id); const had = el.value; el.innerHTML = methods; el.value = had || s.defaultPaymentMethod;
      });
      Selects.customers();
    },
    /** Refresh every product drop-down (filters + each bill line), keeping what is selected. */
    products() {
      Selects.keep($('#sh-product'), Selects.options(State.products, { value: (p) => p.productId, label: (p) => p.productName, blank: 'All products' }));
      $$('.sale-line', $('#sale-lines')).forEach((row) => RecordSale.fillProductSelect(row));
    },
    customers() {
      $('#customer-list').innerHTML = State.customers.map((c) => `<option value="${esc(c.customerName)}"></option>`).join('');
    }
  };

  const Router = {
    routes: {},
    current: null,
    register(name, page) { this.routes[name] = page; },
    go(name) { if (location.hash !== '#' + name) location.hash = name; else this.render(); },
    async render() {
      const name = (location.hash || '').replace('#', '');
      const route = this.routes[name] ? name : 'dashboard';
      this.current = route;
      $$('.page').forEach((p) => { p.hidden = p.id !== 'page-' + route; });
      const pageEl = $('#page-' + route);
      $('#page-title').textContent = pageEl.dataset.title;
      document.title = pageEl.dataset.title + ' · Millet Laddoo Business Manager';
      $$('[data-route]').forEach((a) => { if (a.dataset.route === route) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
      Shell.closeSidebar();
      window.scrollTo(0, 0);
      const page = this.routes[route];
      if (!page.started && page.init) { page.init(); page.started = true; }
      if (page.show) {
        try { await page.show(); } catch (e) { UI.toast(e.message, 'error'); }
      }
    }
  };

  const Shell = {
    init() {
      $('#menu-btn').addEventListener('click', Shell.openSidebar);
      $('#bottom-more').addEventListener('click', Shell.openSidebar);
      $('#sidebar-close').addEventListener('click', Shell.closeSidebar);
      $('#sidebar-backdrop').addEventListener('click', Shell.closeSidebar);
      $('#refresh-btn').addEventListener('click', async () => {
        try { await loadCore(); await Router.render(); UI.toast('Data reloaded from Google Sheets.'); } catch (e) { UI.toast(e.message, 'error'); }
      });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') Shell.closeSidebar(); });
      // Dialog close buttons & backdrop clicks.
      $$('dialog').forEach((d) => {
        d.addEventListener('click', (e) => {
          if (e.target.closest('[data-close]')) d.close();
          else if (e.target === d) {
            const r = d.getBoundingClientRect();
            if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
          }
        });
      });
      $('#today-label').textContent = Dates.long(Dates.today());
      window.addEventListener('hashchange', () => Router.render());
    },
    openSidebar() { $('#sidebar').classList.add('open'); $('#sidebar-backdrop').hidden = false; },
    closeSidebar() { $('#sidebar').classList.remove('open'); $('#sidebar-backdrop').hidden = true; }
  };

  /* ===================== Start-up of the app shell (no login) ===================== */
  const Boot = {
    async enter() {
      $('#app').hidden = false;
      if (!Api.configured()) {
        $('#content').insertAdjacentHTML('afterbegin', '<p class="notice notice-warn">The web app address is not set. Open <code>config.js</code> and paste your Apps Script web app URL into <code>API_URL</code>.</p>');
        Selects.fillAll();
        Router.render();
        return;
      }
      Selects.fillAll();   // items and payment methods are available before the server answers
      try { await loadCore(); } catch (e) {
        $('#content').insertAdjacentHTML('afterbegin', `<div class="notice notice-warn"><p><b>Could not load data:</b> ${esc(e.message)}</p>
          <p style="margin-top:8px">You can see the item list, but bills cannot be saved and no records can load until this is fixed. Check:</p>
          <ol class="method-list" style="color:inherit;margin-top:6px">
            <li>Open <a href="${esc(CFG.API_URL)}" target="_blank" rel="noopener">your web app link</a> in a new tab. It must show text starting with <code>{"success":true</code>. A Google sign-in page means step 2 is wrong; an error page means step 3 or 4.</li>
            <li>In Apps Script: Deploy → Manage deployments → Edit → <b>Who has access: Anyone</b> (not "Anyone with Google account").</li>
            <li>Run the <code>setup</code> function once in the Apps Script editor and allow access.</li>
            <li>After pasting new code, deploy a <b>New version</b> (Manage deployments → Edit → Version: New version). The link in <code>config.js</code> must end in <code>/exec</code>.</li>
          </ol></div>`);
        Router.render();   // still open the page so the item list is visible
        return;
      }
      Router.render();
    }
  };

  /* ===================== 6. Shared widgets ===================== */
  /**
   * Table renderer. columns: [{ label, key?, num?, render?(row) → HTML, cls?, sortKey? }]
   * Rows collapse to cards on phones using data-label.
   */
  function table(columns, rows, { empty = 'Nothing to show yet.', emptySub = '', footer = null, rowClass = null, sort = null } = {}) {
    if (!rows.length) return UI.empty(empty, emptySub);
    const head = columns.map((c) => {
      const sortable = sort && c.sortKey;
      const aria = sortable && sort.key === c.sortKey ? ` aria-sort="${sort.dir === 'asc' ? 'ascending' : 'descending'}"` : '';
      return `<th class="${c.num ? 'num' : ''}${sortable ? ' sortable' : ''}"${sortable ? ` data-sort="${c.sortKey}" tabindex="0"` : ''}${aria}>${esc(c.label)}</th>`;
    }).join('');
    const body = rows.map((r) => `<tr class="${rowClass ? rowClass(r) : ''}">` + columns.map((c) => {
      const v = c.render ? c.render(r) : esc(r[c.key]);
      return `<td data-label="${esc(c.label)}" class="${c.num ? 'num ' : ''}${c.cls || ''}">${v === '' ? '<span class="muted">–</span>' : v}</td>`;
    }).join('') + '</tr>').join('');
    const foot = footer ? `<tfoot><tr>${footer.map((f, i) => `<td data-label="${esc(columns[i] ? columns[i].label : '')}" class="${columns[i] && columns[i].num ? 'num' : ''}">${f}</td>`).join('')}</tr></tfoot>` : '';
    return `<div class="table-wrap cards"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table></div>`;
  }

  /** Client-side pagination helper. */
  function paginate(rows, state) {
    const size = CFG.PAGE_SIZE || 20;
    const pages = Math.max(1, Math.ceil(rows.length / size));
    state.page = Math.min(Math.max(1, state.page || 1), pages);
    return { slice: rows.slice((state.page - 1) * size, state.page * size), pages, total: rows.length, size };
  }
  function renderPager(el, info, state, onChange) {
    if (info.total <= info.size) { el.innerHTML = info.total ? `<span>${info.total} record${info.total === 1 ? '' : 's'}</span>` : ''; return; }
    const start = (state.page - 1) * info.size + 1, end = Math.min(state.page * info.size, info.total);
    el.innerHTML = `<span>Showing ${start}–${end} of ${info.total}</span><div class="btns">
      <button type="button" class="btn btn-secondary btn-sm" data-pg="prev" ${state.page <= 1 ? 'disabled' : ''}>Previous</button>
      <button type="button" class="btn btn-secondary btn-sm" data-pg="next" ${state.page >= info.pages ? 'disabled' : ''}>Next</button></div>`;
    el.onclick = (e) => {
      const b = e.target.closest('[data-pg]'); if (!b) return;
      state.page += b.dataset.pg === 'next' ? 1 : -1;
      onChange();
    };
  }

  function initTabs(name, onChange) {
    const bar = $(`[data-tabs="${name}"]`);
    const page = bar.parentElement;
    bar.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab]'); if (!t) return;
      select(t.dataset.tab);
    });
    function select(tab) {
      $$('[data-tab]', bar).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
      $$(':scope > .tab-panel', page).forEach((p) => { p.hidden = p.dataset.panel !== tab; });
      if (onChange) onChange(tab);
    }
    return { select, current: () => $('[aria-selected="true"]', bar).dataset.tab };
  }

  /** CSV with correct escaping and spreadsheet formula-injection protection. */
  const Csv = {
    cell(v) {
      if (v === null || v === undefined) return '';
      let s = typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v);
      if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
      if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
      return s;
    },
    build(headers, rows) { return '﻿' + [headers].concat(rows).map((r) => r.map(Csv.cell).join(',')).join('\r\n'); },
    download(filename, headers, rows) {
      if (DEMO && window.LADDOO_DEMO_DOWNLOAD) { window.LADDOO_DEMO_DOWNLOAD(filename, Csv.build(headers, rows), rows.length); return; }
      const blob = new Blob([Csv.build(headers, rows)], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      UI.toast(`Downloaded ${filename} (${rows.length} rows). It opens in Excel or Google Sheets.`);
    },
    name(base, range) { return `laddoo-${base}${range ? `_${range.from}_to_${range.to}` : ''}_${Dates.today()}.csv`; }
  };

  /** Chart helpers (Chart.js from CDN; pages still work without it). */
  const Charts = {
    store: {},
    color(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); },
    draw(id, config) {
      const canvas = document.getElementById(id);
      if (!canvas) return;
      if (typeof window.Chart === 'undefined') {
        canvas.parentElement.innerHTML = '<p class="muted small">Charts could not load (no internet connection to the chart library). The figures are still shown in the tables.</p>';
        return;
      }
      if (Charts.store[id]) Charts.store[id].destroy();
      const ink = Charts.color('--muted'), grid = Charts.color('--line');
      Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
      Chart.defaults.color = ink;
      config.options = Object.assign({
        responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ' ' + Fmt.inr(c.parsed[config.options && config.options.indexAxis === 'y' ? 'x' : 'y']) } } }
      }, config.options || {});
      const money = { ticks: { callback: (v) => Fmt.inrShort(v) }, grid: { color: grid }, beginAtZero: true };
      const plain = { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, autoSkipPadding: 12 } };
      config.options.scales = config.options.indexAxis === 'y' ? { x: money, y: plain } : { x: plain, y: money };
      Charts.store[id] = new Chart(canvas, config);
    }
  };

  /* ===================== 7. Page controllers ===================== */

  /* ---------- Dashboard ---------- */
  const Dashboard = {
    range: null,
    init() {
      Dashboard.range = Dates.preset(CFG.DEFAULT_DASHBOARD_RANGE || 'month');
      const f = $('#dash-filters');
      $$('[data-preset]', f).forEach((b) => b.addEventListener('click', () => {
        Dashboard.range = Dates.preset(b.dataset.preset);
        Dashboard.load();
      }));
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        const from = $('#dash-from').value, to = $('#dash-to').value;
        if (!Dates.valid(from) || !Dates.valid(to) || from > to) { UI.toast('Choose a valid date range (start date on or before end date).', 'error'); return; }
        Dashboard.range = { from, to };
        Dashboard.load();
      });
    },
    show() { return Dashboard.load(); },
    async load() {
      const r = Dashboard.range;
      $('#dash-from').value = r.from; $('#dash-to').value = r.to;
      $$('#dash-filters [data-preset]').forEach((b) => { const p = Dates.preset(b.dataset.preset); b.setAttribute('aria-pressed', String(p.from === r.from && p.to === r.to)); });
      if (!$('#dash-metrics').innerHTML) $('#dash-metrics').innerHTML = UI.loadingBlock();
      const d = (await Api.call('getDashboard', r)).data;
      Dashboard.render(d);
    },
    render(d) {
      const m = d.metrics;
      const period = d.range.from === d.range.to ? Fmt.date(d.range.from) : `${Fmt.date(d.range.from)} to ${Fmt.date(d.range.to)}`;
      const card = (cls, label, value, note) => `<div class="metric ${cls}"><span class="metric-label">${esc(label)}</span><span class="metric-value">${value}</span>${note ? `<span class="metric-note">${note}</span>` : ''}</div>`;
      $('#dash-metrics').innerHTML = [
        card('is-revenue', "Today's sales revenue", Fmt.inr(m.todayRevenue), 'Bills made today (paid or not)'),
        card('is-revenue', "This month's sales revenue", Fmt.inr(m.monthRevenue), 'From the 1st of this month'),
        card('is-revenue', 'Sales revenue (period)', Fmt.inr(m.revenue), esc(period)),
        card('is-revenue', 'Bills', Fmt.qty(m.transactions), 'Non-cancelled bills in period'),
        card('is-cash', 'Cash received', Fmt.inr(m.cashReceived), 'Payments minus refunds in period'),
        card('is-expense', 'Total expenses', Fmt.inr(m.totalExpenses), 'All expenses in period'),
        card('is-profit', 'Profit', `<span class="${m.profit < 0 ? 'neg' : ''}">${Fmt.inr(m.profit)}</span>`, 'Sales revenue − expenses'),
        card('is-due', 'Outstanding customer payments', Fmt.inr(m.outstanding), `${m.outstandingCount} unpaid or part-paid bill${m.outstandingCount === 1 ? '' : 's'} (all dates)`)
      ].join('');

      const daily = d.charts.daily;
      $('#dash-daily-caption').textContent = daily.length ? `${Fmt.date(daily[0].date)} to ${Fmt.date(daily[daily.length - 1].date)}` : '';
      Charts.draw('chart-daily', { type: 'bar', data: { labels: daily.map((x) => Fmt.date(x.date).slice(0, 5)), datasets: [{ data: daily.map((x) => x.revenue), backgroundColor: Charts.color('--chart-1'), borderRadius: 4, maxBarThickness: 28 }] } });
      Charts.draw('chart-monthly', { type: 'bar', data: { labels: d.charts.monthly.map((x) => Fmt.month(x.month)), datasets: [{ data: d.charts.monthly.map((x) => x.revenue), backgroundColor: Charts.color('--chart-2'), borderRadius: 4, maxBarThickness: 36 }] } });
      const bp = d.charts.byProduct;
      const palette = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6'].map(Charts.color);
      if (bp.length) {
        Charts.draw('chart-products', { type: 'bar', data: { labels: bp.map((x) => x.productName), datasets: [{ data: bp.map((x) => x.revenue), backgroundColor: bp.map((_, i) => palette[i % palette.length]), borderRadius: 4, maxBarThickness: 30 }] }, options: { indexAxis: 'y' } });
      } else if (Charts.store['chart-products']) { Charts.store['chart-products'].destroy(); delete Charts.store['chart-products']; }

      $('#dash-due').innerHTML = d.dueBills.length ? d.dueBills.map((b) => `<div class="alert-row"><svg><use href="#i-alert"/></svg><div class="grow"><a href="#" data-view-sale="${esc(b.saleId)}"><b>${esc(b.customerName)}</b></a><span class="sub">${Fmt.date(b.date)} · ${esc(b.products)}</span></div><span class="pill bad">${Fmt.inr(b.balanceDue)}</span></div>`).join('')
        : UI.empty('Nothing is owed', 'Every bill is fully paid.');

      $('#dash-recent-sales').innerHTML = table([
        { label: 'Date', render: (s) => Fmt.date(s.date) },
        { label: 'Customer', render: (s) => `<a href="#" data-view-sale="${esc(s.saleId)}">${esc(s.customerName)}</a><span class="sub">${esc(s.products)}</span>` },
        { label: 'Total', num: true, render: (s) => Fmt.inr(s.totalAmount) },
        { label: 'Status', render: (s) => Fmt.statusPill(s.status === 'CANCELLED' ? 'Cancelled' : s.paymentStatus) }
      ], d.recentSales, { empty: 'No sales in this period', emptySub: 'Use Record Sale to add one.' });
      $('#dash-recent-expenses').innerHTML = table([
        { label: 'Date', render: (x) => Fmt.date(x.date) },
        { label: 'Expense', render: (x) => `${esc(x.description)}<span class="sub">${esc(x.category)}</span>` },
        { label: 'Amount', num: true, render: (x) => Fmt.inr(x.amount) }
      ], d.recentExpenses, { empty: 'No expenses in this period' });
    }
  };

  /* ---------- Record Sale (new and edit) ---------- */
  const RecordSale = {
    editing: null,       // { sale, items, received } when editing
    init() {
      const form = $('#form-sale');
      $('#sale-add-line').addEventListener('click', () => RecordSale.addLine());
      $('#sale-lines').addEventListener('change', RecordSale.onLineChange);
      $('#sale-lines').addEventListener('input', RecordSale.recalc);
      $('#sale-lines').addEventListener('click', (e) => {
        const b = e.target.closest('[data-remove-line]'); if (!b) return;
        b.closest('.sale-line').remove();
        if (!$('#sale-lines').children.length) RecordSale.addLine();
        RecordSale.renumber(); RecordSale.recalc();
      });
      ['#sale-discount', '#sale-received'].forEach((id) => $(id).addEventListener('input', RecordSale.recalc));
      $('#sale-paid-full').addEventListener('click', () => { $('#sale-received').value = (RecordSale.totals().totP / 100).toFixed(2); RecordSale.recalc(); });
      $('#sale-paid-none').addEventListener('click', () => { $('#sale-received').value = '0'; RecordSale.recalc(); });
      $('#sale-reset').addEventListener('click', async () => {
        if (RecordSale.editing) { RecordSale.editing = null; RecordSale.reset(); Router.go('sales'); return; }
        RecordSale.reset();
      });
      form.addEventListener('submit', RecordSale.save);
      RecordSale.reset();
    },
    async show() {
      await loadCore();
      $$('.sale-line', $('#sale-lines')).forEach((row) => RecordSale.fillProductSelect(row));
      RecordSale.recalc();
    },
    reset() {
      const form = $('#form-sale');
      UI.clearInvalid(form); freshRequest(form);
      RecordSale.editing = null;
      $('#sale-id').value = '';
      $('#sale-date').value = Dates.today(); $('#sale-date').max = Dates.today();
      $('#sale-customer').value = '';
      if (State.loaded) $('#sale-method').value = State.settings.defaultPaymentMethod;
      $('#sale-discount').value = '0'; $('#sale-received').value = '0'; $('#sale-ref').value = ''; $('#sale-notes').value = '';
      $('#sale-lines').innerHTML = '';
      RecordSale.addLine();
      $('#sale-edit-banner').hidden = true;
      $('#sale-payment-new').hidden = false; $('#sale-payment-edit').hidden = true;
      $('#sale-submit').textContent = 'Save sale';
      $('#sale-reset').textContent = 'Clear form';
      $('#page-record-sale').dataset.title = 'Record Sale';
      if (Router.current === 'record-sale') $('#page-title').textContent = 'Record Sale';
      RecordSale.recalc();
    },
    fillProductSelect(row, keepId) {
      const sel = $('.l-product', row);
      const list = State.products.slice();
      if (keepId && !productById(keepId)) list.push({ productId: keepId, productName: keepId + ' (old)', sellingPrice: 0, boxSize: '' });
      Selects.keep(sel, Selects.options(list, { value: (p) => p.productId, label: (p) => p.productName, blank: 'Choose product', addNew: '+ Add new item…' }));
    },
    addLine(prefill) {
      const row = document.createElement('div');
      row.className = 'sale-line';
      const n = $('#sale-lines').children.length + 1;
      row.innerHTML = `
        <div class="field f-product"><label>Product <span class="ln">${n}</span></label><select class="l-product" aria-label="Product"></select></div>
        <div class="field"><label>Unit</label><select class="l-unit" aria-label="Unit"></select></div>
        <div class="field"><label>Quantity</label><input class="l-qty" type="number" min="0" step="any" inputmode="decimal" aria-label="Quantity"></div>
        <div class="field"><label>Price / unit (₹)</label><input class="l-price" type="number" min="0" step="0.01" inputmode="decimal" aria-label="Selling price per unit"></div>
        <div class="field"><label>Line total</label><div class="line-total">₹0.00</div></div>
        <button type="button" class="icon-btn" data-remove-line aria-label="Remove this line" title="Remove line"><svg><use href="#i-x"/></svg></button>
`;
      $('#sale-lines').appendChild(row);
      RecordSale.fillProductSelect(row, prefill && prefill.productId);
      if (prefill) {
        $('.l-product', row).value = prefill.productId;
        RecordSale.syncUnits(row);
        $('.l-unit', row).value = prefill.unit;
        $('.l-qty', row).value = prefill.quantity;
        $('.l-price', row).value = prefill.unitPrice;
      }
      RecordSale.recalc();
      return row;
    },
    renumber() { $$('.sale-line .ln').forEach((s, i) => { s.textContent = i + 1; }); },
    syncUnits(row) {
      const p = productById($('.l-product', row).value);
      const opts = p ? ['<option value="Piece">Piece</option>'].concat(p.boxSize ? [`<option value="Box">Box (${Fmt.qty(p.boxSize)} pieces)</option>`] : []) : [];
      $('.l-unit', row).innerHTML = opts.join('');
    },
    defaultPrice(row) {
      const p = productById($('.l-product', row).value);
      if (!p) return;
      const unit = $('.l-unit', row).value;
      const price = Number(unit === 'Box' ? p.boxPrice : p.sellingPrice) || 0;
      $('.l-price', row).value = price > 0 ? (Math.round(price * 100) / 100).toString() : '';   // no price set → type it on the bill
    },
    onLineChange(e) {
      const row = e.target.closest('.sale-line'); if (!row) return;
      if (e.target.classList.contains('l-product') && e.target.value === ADD_NEW) { AddNew.start(e.target, 'products'); return; }
      if (e.target.classList.contains('l-product')) {
        RecordSale.syncUnits(row); RecordSale.defaultPrice(row);
        if (!$('.l-qty', row).value) $('.l-qty', row).value = '1';
      }
      if (e.target.classList.contains('l-unit')) RecordSale.defaultPrice(row);
      RecordSale.recalc();
    },
    readLines() {
      return $$('.sale-line', $('#sale-lines')).map((row) => ({
        row, productId: $('.l-product', row).value, unit: $('.l-unit', row).value,
        quantity: $('.l-qty', row).value.trim(), unitPrice: $('.l-price', row).value.trim()
      }));
    },
    totals() {
      const lines = RecordSale.readLines();
      const subP = lines.reduce((a, l) => a + Math.round((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0) * 100), 0);
      const discP = toPaise($('#sale-discount').value);
      const totP = subP - discP;
      const recP = RecordSale.editing ? toPaise(RecordSale.editing.received) : toPaise($('#sale-received').value);
      return { lines, subP, discP, totP, recP };
    },
    recalc() {
      const t = RecordSale.totals();
      t.lines.forEach((l) => {
        $('.line-total', l.row).textContent = Fmt.inr(Math.round((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0) * 100) / 100);
      });
      $('#sum-subtotal').textContent = Fmt.inr(t.subP / 100);
      $('#sum-total').textContent = Fmt.inr(t.totP / 100);
      $('#sum-balance').textContent = Fmt.inr((t.totP - t.recP) / 100);
      const status = t.totP <= 0 ? 'Paid' : t.recP <= 0 ? 'Pending' : t.recP < t.totP ? 'Partially Paid' : 'Paid';
      $('#sum-status').outerHTML = Fmt.statusPill(status).replace('<span ', '<span id="sum-status" ');
      return t;
    },
    async save(e) {
      e.preventDefault();
      const form = $('#form-sale');
      UI.clearInvalid(form);
      const t = RecordSale.recalc();
      let ok = true;
      const bad = (el, msg) => { ok = false; UI.invalid(el, msg); };
      if (!Dates.valid($('#sale-date').value) || $('#sale-date').value > Dates.today()) bad($('#sale-date'), 'Enter a valid sale date that is not in the future.');
      const used = t.lines.filter((l) => l.productId || l.quantity);
      if (!used.length) { ok = false; UI.formError(form, 'Add at least one product.'); }
      used.forEach((l) => {
        if (!l.productId) bad($('.l-product', l.row), 'Choose a product.');
        if (!R.pos(l.quantity) || !Number.isInteger(Number(l.quantity))) bad($('.l-qty', l.row), 'Quantity must be a whole number more than 0.');
        if (!R.money(l.unitPrice)) bad($('.l-price', l.row), 'Enter the price for this item.');
      });
      if (!R.money($('#sale-discount').value || '0')) bad($('#sale-discount'), 'Discount must be ₹0 or more.');
      else if (t.discP > t.subP) bad($('#sale-discount'), 'Discount cannot be more than the subtotal.');
      if (!RecordSale.editing) {
        if (!R.money($('#sale-received').value || '0')) bad($('#sale-received'), 'Amount must be ₹0 or more.');
        else if (t.recP > t.totP) bad($('#sale-received'), 'Amount received cannot be more than the grand total.');
      } else if (t.recP > t.totP) { ok = false; UI.formError(form, `${Fmt.inr(t.recP / 100)} has already been received, which is more than the new total. Record a refund on this sale first.`); }
      if (!ok) { if (!$('.form-error', form).textContent) UI.formError(form, 'Please correct the highlighted fields.'); return; }

      const items = used.map((l) => ({ productId: l.productId, unit: l.unit, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) }));
      const base = { date: $('#sale-date').value, customerName: $('#sale-customer').value.trim() || 'Walk-in', items, discount: Number($('#sale-discount').value || 0), notes: $('#sale-notes').value.trim() };
      if (RecordSale.editing) {
        await submitWrite(form, 'updateSale', Object.assign({ saleId: RecordSale.editing.sale.saleId }, base), async () => {
          RecordSale.editing = null; RecordSale.reset(); await loadCore(); Router.go('sales');
        });
      } else {
        const payload = Object.assign(base, { amountReceived: Number($('#sale-received').value || 0), paymentMethod: $('#sale-method').value, paymentReference: $('#sale-ref').value.trim() });
        await submitWrite(form, 'saveSale', payload, async () => {
          const keepDate = $('#sale-date').value;
          RecordSale.reset(); $('#sale-date').value = keepDate;
          await loadCore(); RecordSale.show();
        });
      }
    },
    async edit(saleId) {
      let d;
      try { d = (await Api.call('getSale', { saleId })).data; } catch (err) { UI.toast(err.message, 'error'); return; }
      if (d.sale.status !== 'ACTIVE') { UI.toast('A cancelled bill cannot be edited.', 'error'); return; }
      UI.close('dlg-view');
      if (!RecordSale.started) { RecordSale.init(); RecordSale.started = true; }
      RecordSale.reset();
      $('#page-record-sale').dataset.title = 'Edit Bill';
      Router.go('record-sale');
      const form = $('#form-sale');
      RecordSale.editing = { sale: d.sale, items: d.items, received: d.sale.amountReceived };
      freshRequest(form);
      $('#sale-id').value = d.sale.saleId;
      $('#sale-date').value = d.sale.date;
      $('#sale-customer').value = d.sale.customerName === 'Walk-in' ? '' : d.sale.customerName;
      $('#sale-discount').value = d.sale.discount;
      $('#sale-notes').value = d.sale.notes ? d.sale.notes : '';
      $('#sale-lines').innerHTML = '';
      d.items.filter((i) => i.status === 'ACTIVE').forEach((i) => RecordSale.addLine(i));
      $('#sale-edit-banner').hidden = false;
      $('#sale-edit-banner').innerHTML = `Editing bill <b>${esc(d.sale.saleId)}</b> from ${Fmt.date(d.sale.date)}. The old lines are kept in the sheet marked EDITED. Payments stay as they are.`;
      $('#sale-payment-new').hidden = true; $('#sale-payment-edit').hidden = false;
      $('#sale-edit-received').textContent = Fmt.inr(d.sale.amountReceived);
      $('#sale-submit').textContent = 'Save changes';
      $('#sale-reset').textContent = 'Stop editing';
      $('#page-title').textContent = 'Edit Bill';
      RecordSale.recalc();
    }
  };

  /* ---------- Sales History, sale details, payments, cancellation ---------- */
  const SalesHistory = {
    rows: [], page: 1, sort: { key: 'date', dir: 'desc' }, range: null,
    init() {
      const t = Dates.today();
      $('#sh-from').value = Dates.add(t, -29); $('#sh-to').value = t;
      $('#sales-filters').addEventListener('submit', (e) => { e.preventDefault(); SalesHistory.page = 1; SalesHistory.load(); });
      $('#sh-export').addEventListener('click', SalesHistory.exportCsv);
      $('#sales-table').addEventListener('click', (e) => {
        const th = e.target.closest('th[data-sort]');
        if (th) { SalesHistory.toggleSort(th.dataset.sort); return; }
        const b = e.target.closest('[data-act]'); if (!b) return;
        const sale = SalesHistory.rows.find((s) => s.saleId === b.dataset.id);
        if (b.dataset.act === 'view') SalesHistory.view(b.dataset.id);
        if (b.dataset.act === 'pay') Payments.open(sale);
        if (b.dataset.act === 'edit') RecordSale.edit(b.dataset.id);
        if (b.dataset.act === 'cancel') Cancel.open(sale);
      });
      $('#sales-table').addEventListener('keydown', (e) => { const th = e.target.closest('th[data-sort]'); if (th && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); SalesHistory.toggleSort(th.dataset.sort); } });
    },
    show() { return SalesHistory.load(); },
    toggleSort(key) {
      const s = SalesHistory.sort;
      s.dir = s.key === key && s.dir === 'desc' ? 'asc' : 'desc'; s.key = key;
      SalesHistory.render();
    },
    async load() {
      const f = formData($('#sales-filters'));
      if (!Dates.valid(f.from) || !Dates.valid(f.to) || f.from > f.to) { UI.toast('Choose a valid date range.', 'error'); return; }
      if (!SalesHistory.rows.length) $('#sales-table').innerHTML = UI.loadingBlock();
      try {
        const d = (await Api.call('getSales', f)).data;
        SalesHistory.rows = d.rows; SalesHistory.range = d.range; SalesHistory.totals = d.totals;
        if (d.truncated) UI.toast('Narrow the date range to see older bills.', 'warn');
        SalesHistory.render();
      } catch (err) { $('#sales-table').innerHTML = UI.errorBlock(err); }
    },
    sorted() {
      const { key, dir } = SalesHistory.sort, m = dir === 'asc' ? 1 : -1;
      return SalesHistory.rows.slice().sort((a, b) => (key === 'amount' ? (a.totalAmount - b.totalAmount) : key === 'balance' ? (a.balanceDue - b.balanceDue) : (a.date + a.createdAt).localeCompare(b.date + b.createdAt)) * m);
    },
    render() {
      const t = SalesHistory.totals || { count: 0, totalAmount: 0, amountReceived: 0, balanceDue: 0 };
      $('#sales-totals').innerHTML = `<span>Active sales: <b>${t.count}</b></span><span>Total: <b>${Fmt.inr(t.totalAmount)}</b></span><span>Received: <b>${Fmt.inr(t.amountReceived)}</b></span><span>Balance due: <b>${Fmt.inr(t.balanceDue)}</b></span>`;
      const info = paginate(SalesHistory.sorted(), SalesHistory);
      $('#sales-table').innerHTML = table([
        { label: 'Date', sortKey: 'date', render: (s) => Fmt.date(s.date) },
        { label: 'Bill no.', render: (s) => `<span class="small">${esc(s.saleId)}</span>` },
        { label: 'Customer', render: (s) => esc(s.customerName) },
        { label: 'Products', render: (s) => `<span class="small">${esc(s.products)}</span>` },
        { label: 'Total', num: true, sortKey: 'amount', render: (s) => Fmt.inr(s.totalAmount) },
        { label: 'Received', num: true, render: (s) => Fmt.inr(s.amountReceived) },
        { label: 'Balance', num: true, sortKey: 'balance', render: (s) => Fmt.inr(s.balanceDue) },
        { label: 'Status', render: (s) => Fmt.statusPill(s.status === 'CANCELLED' ? 'Cancelled' : s.paymentStatus) },
        { label: '', cls: 'actions', render: (s) => `<button class="link-btn" data-act="view" data-id="${s.saleId}">View</button>` + (s.status === 'ACTIVE'
          ? `${s.balanceDue > 0 ? `<button class="link-btn" data-act="pay" data-id="${s.saleId}">Payment</button>` : ''}<button class="link-btn" data-act="edit" data-id="${s.saleId}">Edit</button><button class="link-btn danger" data-act="cancel" data-id="${s.saleId}">Cancel</button>` : '') }
      ], info.slice, { empty: 'No sales match these filters', emptySub: 'Try a wider date range or clear the search.', sort: SalesHistory.sort, rowClass: (s) => (s.status === 'CANCELLED' ? 'is-void' : '') });
      renderPager($('#sales-pager'), info, SalesHistory, SalesHistory.render);
    },
    exportCsv() {
      const rows = SalesHistory.sorted();
      Csv.download(Csv.name('sales', SalesHistory.range), ['Date', 'Bill no.', 'Customer', 'Products', 'Subtotal', 'Discount', 'Total', 'Received', 'Balance due', 'Payment status', 'Sale status', 'Notes'],
        rows.map((s) => [Fmt.date(s.date), s.saleId, s.customerName, s.products, s.subtotal, s.discount, s.totalAmount, s.amountReceived, s.balanceDue, s.paymentStatus, s.status, s.notes]));
    },
    async view(saleId) {
      $('#dlg-view-title').textContent = 'Bill ' + saleId;
      $('#dlg-view-body').innerHTML = UI.loadingBlock();
      $('#dlg-view-foot').innerHTML = '';
      UI.open('dlg-view');
      let d;
      try { d = (await Api.call('getSale', { saleId })).data; } catch (err) { $('#dlg-view-body').innerHTML = UI.errorBlock(err); return; }
      const s = d.sale;
      $('#dlg-view-body').innerHTML = `<dl class="kv">
        <div><dt>Date</dt><dd>${Fmt.date(s.date)}</dd></div>
        <div><dt>Customer</dt><dd>${esc(s.customerName)}</dd></div>
        <div><dt>Status</dt><dd>${Fmt.statusPill(s.status === 'CANCELLED' ? 'Cancelled' : s.paymentStatus)}</dd></div>
        <div><dt>Subtotal</dt><dd>${Fmt.inr(s.subtotal)}</dd></div>
        <div><dt>Discount</dt><dd>${Fmt.inr(s.discount)}</dd></div>
        <div><dt>Grand total</dt><dd>${Fmt.inr(s.totalAmount)}</dd></div>
        <div><dt>Received</dt><dd>${Fmt.inr(s.amountReceived)}</dd></div>
        <div><dt>Balance due</dt><dd>${Fmt.inr(s.balanceDue)}</dd></div>
      </dl>${s.notes ? `<p class="small">${esc(s.notes)}</p>` : ''}
      <h3>Items</h3>${table([
        { label: 'Product', render: (i) => `${esc(i.productName)}${i.status !== 'ACTIVE' ? ` <span class="pill void">${esc(i.status.toLowerCase())}</span>` : ''}` },
        { label: 'Qty', num: true, render: (i) => `${Fmt.qty(i.quantity)} ${esc(i.unit)}` },
        { label: 'Price', num: true, render: (i) => Fmt.inr(i.unitPrice) },
        { label: 'Discount', num: true, render: (i) => Fmt.inr(i.discount) },
        { label: 'Line total', num: true, render: (i) => Fmt.inr(i.lineTotal) }
      ], d.items, { empty: 'No items' })}
      <h3>Payments</h3>${table([
        { label: 'Date', render: (p) => Fmt.date(p.date) },
        { label: 'Type', render: (p) => (p.type === 'REFUND' ? '<span class="pill warn">Refund</span>' : 'Payment') },
        { label: 'Method', render: (p) => `${esc(p.method)}${p.reference ? `<span class="sub">${esc(p.reference)}</span>` : ''}` },
        { label: 'Amount', num: true, render: (p) => (p.type === 'REFUND' ? '−' : '') + Fmt.inr(p.amount) },
        { label: '', cls: 'actions', render: (p) => (p.status === 'VOID' ? '<span class="pill void">Void</span>' : s.status === 'ACTIVE' ? `<button class="link-btn danger" data-void-pay="${esc(p.paymentId)}">Void</button>` : '') }
      ], d.payments, { empty: 'No payments recorded', rowClass: (p) => (p.status === 'VOID' ? 'is-void' : '') })}`;
      const foot = $('#dlg-view-foot');
      foot.innerHTML = `<button class="btn btn-ghost" data-close>Close</button>` + (s.status === 'ACTIVE' ? `<button class="btn btn-danger-ghost" id="v-cancel">Cancel sale</button><button class="btn btn-secondary" id="v-edit">Edit</button>${s.balanceDue > 0 ? '<button class="btn btn-primary" id="v-pay">Record payment</button>' : '<button class="btn btn-secondary" id="v-refund">Record refund</button>'}` : '');
      if (s.status === 'ACTIVE') {
        $('#v-cancel').onclick = () => { UI.close('dlg-view'); Cancel.open(s); };
        $('#v-edit').onclick = () => RecordSale.edit(s.saleId);
        if ($('#v-pay')) $('#v-pay').onclick = () => { UI.close('dlg-view'); Payments.open(s); };
        if ($('#v-refund')) $('#v-refund').onclick = () => { UI.close('dlg-view'); Payments.open(s, 'REFUND'); };
      }
      $('#dlg-view-body').onclick = async (e) => {
        const b = e.target.closest('[data-void-pay]'); if (!b) return;
        const reason = await UI.confirm({ title: 'Void this payment?', message: 'Use this only for a payment entered by mistake. The balance due will go back up.', okLabel: 'Void payment', needReason: true });
        if (reason === null) return;
        try {
          const res = await Api.call('voidPayment', { paymentId: b.dataset.voidPay, reason }, { requestId: uuid() });
          UI.toast(res.message); SalesHistory.view(s.saleId); SalesHistory.refreshIfVisible();
        } catch (err) { UI.toast(err.message, 'error'); }
      };
    },
    refreshIfVisible() {
      if (Router.current === 'sales') SalesHistory.load();
      if (Router.current === 'dashboard') Dashboard.load();
      if (Router.current === 'customers') Customers.load();
      if (Router.current === 'reports' && Reports.data) Reports.load();
    }
  };

  const Payments = {
    init() { $('#form-payment').addEventListener('submit', Payments.save); $('#pay-type').addEventListener('change', Payments.syncType); },
    sale: null,
    open(sale, type) {
      Payments.sale = sale;
      const form = $('#form-payment');
      form.reset(); UI.clearInvalid(form); freshRequest(form);
      form.elements.saleId.value = sale.saleId;
      $('#pay-info').innerHTML = `<div><b>${esc(sale.customerName)}</b> · ${esc(sale.saleId)} · ${Fmt.date(sale.date)}</div><div class="small">Total ${Fmt.inr(sale.totalAmount)} · Received ${Fmt.inr(sale.amountReceived)} · <b>Balance ${Fmt.inr(sale.balanceDue)}</b></div>`;
      $('#pay-type').value = type || 'PAYMENT';
      $('#pay-date').value = Dates.today(); $('#pay-date').max = Dates.today(); $('#pay-date').min = sale.date;
      $('#pay-method').value = State.settings.defaultPaymentMethod;
      Payments.syncType();
      UI.open('dlg-payment');
    },
    syncType() {
      const refund = $('#pay-type').value === 'REFUND', s = Payments.sale;
      $('#pay-amount').value = refund ? (s.amountReceived || 0).toFixed(2) : (s.balanceDue || 0).toFixed(2);
      $('#dlg-payment-title').textContent = refund ? 'Record refund' : 'Record payment';
    },
    async save(e) {
      e.preventDefault();
      const form = e.target, s = Payments.sale, refund = $('#pay-type').value === 'REFUND';
      const limit = refund ? s.amountReceived : s.balanceDue;
      const ok = validate(form, [
        ['date', (v) => R.notFuture(v) && v >= s.date, 'Date must be between the sale date and today.'],
        ['amount', (v) => R.money(v) && Number(v) > 0 && toPaise(v) <= toPaise(limit), refund ? `Refund must be more than ₹0 and at most ${Fmt.inr(limit)}.` : `Payment must be more than ₹0 and at most the balance ${Fmt.inr(limit)}.`]
      ]);
      if (!ok) return;
      const d = formData(form); d.amount = Number(d.amount);
      await submitWrite(form, 'savePayment', d, async () => { UI.close('dlg-payment'); SalesHistory.refreshIfVisible(); });
    }
  };

  const Cancel = {
    init() {
      $('#form-cancel').addEventListener('submit', Cancel.save);
      $$('#form-cancel input[name="receivedHandling"]').forEach((r) => r.addEventListener('change', () => { $('#cancel-refund-method-box').hidden = Cancel.handling() !== 'REFUND'; }));
    },
    handling() { const r = $('#form-cancel input[name="receivedHandling"]:checked'); return r ? r.value : 'REFUND'; },
    open(sale) {
      const form = $('#form-cancel');
      form.reset(); UI.clearInvalid(form); freshRequest(form);
      form.elements.saleId.value = sale.saleId;
      form.elements.confirmReceived.value = sale.amountReceived;
      $('#cancel-sale-id').textContent = `${sale.saleId} (${sale.customerName}, ${Fmt.inr(sale.totalAmount)})`;
      $('#cancel-received-box').hidden = !(sale.amountReceived > 0);
      $('#cancel-received').textContent = Fmt.inr(sale.amountReceived);
      $('#cancel-refund-method').value = State.settings.defaultPaymentMethod;
      $('#cancel-refund-method-box').hidden = false;
      UI.open('dlg-cancel');
    },
    async save(e) {
      e.preventDefault();
      const form = e.target;
      if (!validate(form, [['reason', R.required, 'Please give a reason for cancelling.']])) return;
      const d = formData(form);
      const payload = { saleId: d.saleId, reason: d.reason, confirmReceived: Number(d.confirmReceived) };
      if (!$('#cancel-received-box').hidden) Object.assign(payload, { receivedHandling: Cancel.handling(), refundMethod: d.refundMethod });
      await submitWrite(form, 'cancelSale', payload, async () => { UI.close('dlg-cancel'); SalesHistory.refreshIfVisible(); });
    }
  };

  /* ---------- Customers (worked out from the Customer name typed on each bill) ---------- */
  const Customers = {
    rows: [], page: 1,
    init() {
      ['#cus-search', '#cus-filter'].forEach((id) => $(id).addEventListener('input', () => { Customers.page = 1; Customers.render(); }));
      $('#customers-table').addEventListener('click', (e) => {
        const b = e.target.closest('[data-act="view"]'); if (b) Customers.view(b.dataset.id);
      });
    },
    async show() { await Customers.load(); },
    async load() {
      if (!Customers.rows.length) $('#customers-table').innerHTML = UI.loadingBlock();
      try {
        Customers.rows = (await Api.call('getCustomers')).data.customers;
        State.customers = Customers.rows; Selects.customers();
        Customers.render();
      } catch (err) { $('#customers-table').innerHTML = UI.errorBlock(err); }
    },
    render() {
      const q = $('#cus-search').value.trim().toLowerCase(), f = $('#cus-filter').value;
      const rows = Customers.rows.filter((c) => (!q || c.customerName.toLowerCase().includes(q)) && (f === 'all' || (f === 'due' && c.outstanding > 0)));
      const due = Customers.rows.reduce((a, c) => a + c.outstanding, 0);
      $('#customers-summary').innerHTML = `<span>Customers: <b>${Customers.rows.length}</b></span><span>Total outstanding: <b>${Fmt.inr(due)}</b></span><span>With balance due: <b>${Customers.rows.filter((c) => c.outstanding > 0).length}</b></span>`;
      const info = paginate(rows, Customers);
      $('#customers-table').innerHTML = table([
        { label: 'Customer', render: (c) => `<b>${esc(c.customerName)}</b>` },
        { label: 'Bills', num: true, render: (c) => Fmt.qty(c.salesCount) },
        { label: 'Total purchases', num: true, render: (c) => Fmt.inr(c.totalPurchases) },
        { label: 'Paid', num: true, render: (c) => Fmt.inr(c.totalPaid) },
        { label: 'Outstanding', num: true, render: (c) => (c.outstanding > 0 ? `<b style="color:var(--bad)">${Fmt.inr(c.outstanding)}</b>` : Fmt.inr(0)) },
        { label: 'Last bill', render: (c) => Fmt.date(c.lastSaleDate) },
        { label: '', cls: 'actions', render: (c) => (c.salesCount ? `<button class="link-btn" data-act="view" data-id="${esc(c.customerName)}">View</button>` : '') }
      ], info.slice, { empty: 'No customers yet', emptySub: 'Customers appear here as soon as you type their name on a bill.' });
      renderPager($('#customers-pager'), info, Customers, Customers.render);
    },
    async view(name) {
      $('#dlg-view-title').textContent = name;
      $('#dlg-view-body').innerHTML = UI.loadingBlock();
      $('#dlg-view-foot').innerHTML = '<button class="btn btn-ghost" data-close>Close</button>';
      UI.open('dlg-view');
      try {
        const d = (await Api.call('getCustomerDetail', { customerId: name })).data, s = d.summary;
        $('#dlg-view-body').innerHTML = `<dl class="kv">
          <div><dt>Bills</dt><dd>${s.salesCount}</dd></div>
          <div><dt>Total purchases</dt><dd>${Fmt.inr(s.totalPurchases)}</dd></div>
          <div><dt>Paid</dt><dd>${Fmt.inr(s.totalPaid)}</dd></div>
          <div><dt>Outstanding</dt><dd>${Fmt.inr(s.outstanding)}</dd></div>
        </dl><h3>Bills</h3>` + table([
          { label: 'Date', render: (x) => Fmt.date(x.date) },
          { label: 'Products', render: (x) => `<span class="small">${esc(x.products)}</span>` },
          { label: 'Total', num: true, render: (x) => Fmt.inr(x.totalAmount) },
          { label: 'Balance', num: true, render: (x) => Fmt.inr(x.balanceDue) },
          { label: 'Status', render: (x) => Fmt.statusPill(x.status === 'CANCELLED' ? 'Cancelled' : x.paymentStatus) },
          { label: '', cls: 'actions', render: (x) => `<button class="link-btn" data-view-sale="${esc(x.saleId)}">Open</button>` }
        ], d.sales, { empty: 'No bills' });
      } catch (err) { $('#dlg-view-body').innerHTML = UI.errorBlock(err); }
    }
  };

  /* ---------- Expenses ---------- */
  const Expenses = {
    rows: [], page: 1, range: null,
    init() {
      const r = Dates.preset('month');
      $('#ex-from').value = r.from; $('#ex-to').value = r.to;
      $('#expense-filters').addEventListener('submit', (e) => { e.preventDefault(); Expenses.page = 1; Expenses.load(); });
      $('#btn-add-expense').addEventListener('click', () => Expenses.openForm(null));
      $('#e-cat').addEventListener('change', (e) => { if (e.target.value === ADD_NEW) AddNew.start(e.target, 'categories'); });
      $('#ex-export').addEventListener('click', () => Csv.download(Csv.name('expenses', Expenses.range),
        ['Date', 'Expense ID', 'Category', 'Description', 'Amount', 'Paid by', 'Status', 'Notes'],
        Expenses.rows.map((x) => [Fmt.date(x.date), x.expenseId, x.category, x.description, x.amount, x.paymentMethod, x.status, x.notes])));
      $('#expenses-table').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        const x = Expenses.rows.find((r) => r.expenseId === b.dataset.id);
        if (b.dataset.act === 'edit') Expenses.openForm(x);
        if (b.dataset.act === 'void') {
          const reason = await UI.confirm({ title: 'Void this expense?', message: `${x.description} (${Fmt.inr(x.amount)}) will be kept in history but no longer counted.`, okLabel: 'Void expense', needReason: true });
          if (reason === null) return;
          try { const res = await Api.call('voidExpense', { expenseId: x.expenseId, reason }, { requestId: uuid() }); UI.toast(res.message); Expenses.load(); }
          catch (err) { UI.toast(err.message, 'error'); }
        }
      });
      const form = $('#form-expense');
      form.addEventListener('submit', Expenses.save);
    },
    show() { return Expenses.load(); },
    async load() {
      const f = formData($('#expense-filters'));
      if (!Dates.valid(f.from) || !Dates.valid(f.to) || f.from > f.to) { UI.toast('Choose a valid date range.', 'error'); return; }
      if (!Expenses.rows.length) $('#expenses-table').innerHTML = UI.loadingBlock();
      try {
        const d = (await Api.call('getExpenses', f)).data;
        Expenses.rows = d.rows; Expenses.range = d.range; Expenses.summary = d.summary;
        Expenses.render();
      } catch (err) { $('#expenses-table').innerHTML = UI.errorBlock(err); }
    },
    render() {
      const s = Expenses.summary;
      $('#expense-summary').innerHTML = `<span>Total spent: <b>${Fmt.inr(s.total)}</b></span><span>Entries: <b>${s.count}</b></span>`;
      const max = Math.max(1, ...s.byCategory.map((c) => c.amount));
      $('#expense-bycat').innerHTML = s.byCategory.length ? `<div class="bar-list">${s.byCategory.map((c) => `<div class="bar-row"><span>${esc(c.category)}</span><b class="num">${Fmt.inr(c.amount)}</b><div class="bar"><span style="width:${(c.amount / max * 100).toFixed(1)}%"></span></div></div>`).join('')}</div>` : '<p class="muted small">No expenses in this period.</p>';
      $('#expense-bymonth').innerHTML = s.monthly.length ? table([{ label: 'Month', render: (m) => Fmt.month(m.month) }, { label: 'Amount', num: true, render: (m) => Fmt.inr(m.amount) }], s.monthly) : '';
      const info = paginate(Expenses.rows, Expenses);
      $('#expenses-table').innerHTML = table([
        { label: 'Date', render: (x) => Fmt.date(x.date) },
        { label: 'Description', render: (x) => `${esc(x.description)}<span class="sub">${esc(x.category)}</span>` },
        { label: 'Paid by', render: (x) => esc(x.paymentMethod) },
        { label: 'Amount', num: true, render: (x) => Fmt.inr(x.amount) },
        { label: '', cls: 'actions', render: (x) => (x.status === 'VOID' ? '<span class="pill void">Void</span>' : `<button class="link-btn" data-act="edit" data-id="${x.expenseId}">Edit</button><button class="link-btn danger" data-act="void" data-id="${x.expenseId}">Void</button>`) }
      ], info.slice, { empty: 'No expenses in this period', emptySub: 'Use "Add expense" to record purchases and running costs.', rowClass: (x) => (x.status === 'VOID' ? 'is-void' : '') });
      renderPager($('#expenses-pager'), info, Expenses, Expenses.render);
    },
    openForm(x) {
      const form = $('#form-expense');
      form.reset(); UI.clearInvalid(form); freshRequest(form);
      $$('.add-new', form).forEach((b) => b.remove());
      if (x && x.category) mergeCategories([x.category]);
      Selects.keep($('#e-cat'), Selects.options(State.settings.expenseCategories, { addNew: '+ Add new category…' }));
      $('#dlg-expense-title').textContent = x ? 'Edit expense' : 'Add expense';
      $('#e-date').max = Dates.today();
      if (x) setForm(form, x);
      else setForm(form, { expenseId: '', date: Dates.today(), paymentMethod: State.settings.defaultPaymentMethod, category: State.settings.expenseCategories[0] });
      UI.open('dlg-expense');
    },
    async save(e) {
      e.preventDefault();
      const form = e.target;
      const ok = validate(form, [
        ['date', R.notFuture, 'Enter a valid date that is not in the future.'],
        ['category', R.required, 'Choose a category.'],
        ['description', R.required, 'Describe the expense.'],
        ['amount', (v) => R.money(v) && Number(v) > 0, 'Enter an amount greater than ₹0.']
      ]);
      if (!ok) return;
      const d = formData(form);
      d.amount = Number(d.amount);
      await submitWrite(form, d.expenseId ? 'updateExpense' : 'saveExpense', d, async () => { UI.close('dlg-expense'); Expenses.load(); });
    }
  };

  /* ---------- Reports ---------- */
  const Reports = {
    data: null, range: null, tabs: null, exports: {},
    init() {
      Reports.tabs = initTabs('reports');
      Reports.range = Dates.preset('month');
      const f = $('#report-filters');
      $$('[data-preset]', f).forEach((b) => b.addEventListener('click', () => { Reports.range = Dates.preset(b.dataset.preset); Reports.load(); }));
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        const from = $('#rep-from').value, to = $('#rep-to').value;
        if (!Dates.valid(from) || !Dates.valid(to) || from > to) { UI.toast('Choose a valid date range.', 'error'); return; }
        Reports.range = { from, to }; Reports.load();
      });
      $('#page-reports').addEventListener('click', (e) => {
        const b = e.target.closest('[data-export-report]'); if (!b) return;
        const x = Reports.exports[b.dataset.exportReport];
        if (x) Csv.download(Csv.name('report-' + b.dataset.exportReport, Reports.data.range), x.headers, x.rows);
      });
    },
    show() { return Reports.load(); },
    async load() {
      const r = Reports.range;
      $('#rep-from').value = r.from; $('#rep-to').value = r.to;
      $$('#report-filters [data-preset]').forEach((b) => { const p = Dates.preset(b.dataset.preset); b.setAttribute('aria-pressed', String(p.from === r.from && p.to === r.to)); });
      ['#rep-sales', '#rep-expenses', '#rep-payments', '#rep-profit'].forEach((id) => { if (!Reports.data) $(id).innerHTML = UI.loadingBlock(); });
      try {
        Reports.data = (await Api.call('getReports', r)).data;
        Reports.render();
      } catch (err) { $('#rep-sales').innerHTML = UI.errorBlock(err); }
    },
    /** Section with a heading, a table and a CSV button wired to the same rows. */
    block(key, title, columns, rows, csv, opts = {}) {
      Reports.exports[key] = csv;
      return `<div class="panel report-section"><div class="report-head"><h2>${esc(title)}</h2>${rows.length ? `<button type="button" class="btn btn-ghost btn-sm" data-export-report="${key}"><svg><use href="#i-download"/></svg>CSV</button>` : ''}</div>${table(columns, rows, opts)}</div>`;
    },
    kv(pairs) { return `<dl class="kv">${pairs.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>`; },
    render() {
      const d = Reports.data, period = `${Fmt.date(d.range.from)} to ${Fmt.date(d.range.to)}`;
      Reports.exports = {};
      // A. Sales
      const s = d.sales;
      $('#rep-sales').innerHTML = `<div class="stack"><div class="panel">${Reports.kv([['Period', period], ['Total revenue', Fmt.inr(s.totalRevenue)], ['Transactions', s.transactions], ['Average sale', Fmt.inr(s.averageSale)], ['Discounts given', Fmt.inr(s.totalDiscount)]])}</div>
        ${Reports.block('sales-by-product', 'Sold by product', [
          { label: 'Product', render: (x) => esc(x.productName) }, { label: 'Boxes', num: true, render: (x) => Fmt.qty(x.boxes) },
          { label: 'Pieces', num: true, render: (x) => Fmt.qty(x.pieces) }, { label: 'Revenue', num: true, render: (x) => Fmt.inr(x.revenue) }],
          s.byProduct, { headers: ['Product', 'Boxes', 'Loose pieces', 'Revenue'], rows: s.byProduct.map((x) => [x.productName, x.boxes, x.pieces, x.revenue]) }, { empty: 'No sales in this period' })}
        ${Reports.block('sales-by-customer', 'Sales by customer', [
          { label: 'Customer', render: (x) => esc(x.customerName) }, { label: 'Sales', num: true, render: (x) => x.transactions },
          { label: 'Revenue', num: true, render: (x) => Fmt.inr(x.revenue) }, { label: 'Still due', num: true, render: (x) => Fmt.inr(x.outstanding) }],
          s.byCustomer, { headers: ['Customer', 'Transactions', 'Revenue', 'Outstanding'], rows: s.byCustomer.map((x) => [x.customerName, x.transactions, x.revenue, x.outstanding]) }, { empty: 'No sales in this period' })}
        <div class="grid-2">
        ${Reports.block('sales-daily', 'Daily sales', [{ label: 'Date', render: (x) => Fmt.date(x.date) }, { label: 'Sales', num: true, render: (x) => x.count }, { label: 'Revenue', num: true, render: (x) => Fmt.inr(x.revenue) }],
          s.daily, { headers: ['Date', 'Transactions', 'Revenue'], rows: s.daily.map((x) => [Fmt.date(x.date), x.count, x.revenue]) }, { empty: 'No sales in this period' })}
        ${Reports.block('sales-monthly', 'Monthly sales', [{ label: 'Month', render: (x) => Fmt.month(x.month) }, { label: 'Sales', num: true, render: (x) => x.count }, { label: 'Revenue', num: true, render: (x) => Fmt.inr(x.revenue) }],
          s.monthly, { headers: ['Month', 'Transactions', 'Revenue'], rows: s.monthly.map((x) => [x.month, x.count, x.revenue]) })}
        </div></div>`;
      // C. Expenses
      const e = d.expenses;
      $('#rep-expenses').innerHTML = `<div class="stack"><div class="panel">${Reports.kv([['Period', period], ['Total expenses', Fmt.inr(e.total)], ['Entries', e.count]])}</div>
        ${Reports.block('expenses-by-category', 'Expenses by category', [{ label: 'Category', render: (x) => esc(x.category) }, { label: 'Amount', num: true, render: (x) => Fmt.inr(x.amount) }],
          e.byCategory, { headers: ['Category', 'Amount'], rows: e.byCategory.map((x) => [x.category, x.amount]) }, { empty: 'No expenses in this period' })}
        <div class="grid-2">
        ${Reports.block('expenses-daily', 'Daily expenses', [{ label: 'Date', render: (x) => Fmt.date(x.date) }, { label: 'Amount', num: true, render: (x) => Fmt.inr(x.amount) }],
          e.daily, { headers: ['Date', 'Amount'], rows: e.daily.map((x) => [Fmt.date(x.date), x.amount]) }, { empty: 'No expenses in this period' })}
        ${Reports.block('expenses-monthly', 'Monthly expenses', [{ label: 'Month', render: (x) => Fmt.month(x.month) }, { label: 'Amount', num: true, render: (x) => Fmt.inr(x.amount) }],
          e.monthly, { headers: ['Month', 'Amount'], rows: e.monthly.map((x) => [x.month, x.amount]) }, { empty: 'No expenses in this period' })}
        </div></div>`;
      // D. Payments
      const p = d.payments;
      const dueCols = [
        { label: 'Date', render: (x) => Fmt.date(x.date) }, { label: 'Customer', render: (x) => esc(x.customerName) },
        { label: 'Total', num: true, render: (x) => Fmt.inr(x.totalAmount) }, { label: 'Received', num: true, render: (x) => Fmt.inr(x.amountReceived) },
        { label: 'Balance', num: true, render: (x) => `<b>${Fmt.inr(x.balanceDue)}</b>` },
        { label: '', cls: 'actions', render: (x) => `<button class="link-btn" data-view-sale="${esc(x.saleId)}">Open</button>` }];
      const dueCsv = (list) => ({ headers: ['Date', 'Bill no.', 'Customer', 'Total', 'Received', 'Balance due', 'Status'], rows: list.map((x) => [Fmt.date(x.date), x.saleId, x.customerName, x.totalAmount, x.amountReceived, x.balanceDue, x.paymentStatus]) });
      $('#rep-payments').innerHTML = `<div class="stack"><div class="panel">${Reports.kv([['Period', period], ['Payments received', Fmt.inr(p.received)], ['Refunds given', Fmt.inr(p.refunded)], ['Net cash received', Fmt.inr(p.netReceived)], [`Outstanding (bills up to ${Fmt.date(d.range.to)})`, Fmt.inr(p.outstandingTotal)]])}</div>
        ${Reports.block('payments-by-method', 'Received by method (net of refunds)', [{ label: 'Method', render: (x) => esc(x.method) }, { label: 'Amount', num: true, render: (x) => Fmt.inr(x.amount) }],
          p.byMethod, { headers: ['Method', 'Net amount'], rows: p.byMethod.map((x) => [x.method, x.amount]) }, { empty: 'No payments in this period' })}
        ${Reports.block('partially-paid', 'Partially paid bills', dueCols, p.partiallyPaid, dueCsv(p.partiallyPaid), { empty: 'No partially paid sales' })}
        ${Reports.block('pending', 'Unpaid bills', dueCols, p.pending, dueCsv(p.pending), { empty: 'No unpaid sales' })}</div>`;
      // E. Profit
      const pr = d.profit;
      Reports.exports.profit = { headers: ['Line', 'Amount'], rows: [['Sales revenue', pr.revenue], ['Expenses', pr.expenses], ['Profit', pr.profit], ['Cash received (net)', pr.cashIn], ['Expenses paid', pr.cashOut], ['Net cash flow', pr.netCashFlow]] };
      $('#rep-profit').innerHTML = `<div class="grid-2"><div class="panel report-section"><div class="report-head"><h2>Profit, ${esc(period)}</h2><button type="button" class="btn btn-ghost btn-sm" data-export-report="profit"><svg><use href="#i-download"/></svg>CSV</button></div>
        <dl class="pl">
          <div><dt>Sales revenue</dt><dd>${Fmt.inr(pr.revenue)}</dd></div>
          <div class="minus"><dt>Expenses</dt><dd>${Fmt.inr(pr.expenses)}</dd></div>
          <div class="total"><dt>Profit</dt><dd style="color:var(${pr.profit < 0 ? '--bad' : '--good'})">${Fmt.inr(pr.profit)}</dd></div>
        </dl></div>
        <div class="panel report-section"><h2>Cash view</h2>
        <dl class="pl">
          <div><dt>Cash received (net of refunds)</dt><dd>${Fmt.inr(pr.cashIn)}</dd></div>
          <div class="minus"><dt>Expenses paid</dt><dd>${Fmt.inr(pr.cashOut)}</dd></div>
          <div class="total"><dt>Net cash flow</dt><dd>${Fmt.inr(pr.netCashFlow)}</dd></div>
        </dl>
        <h3>How profit is calculated</h3><ul class="method-list">${pr.method.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div></div>`;
    }
  };

  /* ---------- Backup & info ---------- */
  const Backup = {
    init() {
      $('#export-buttons').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-export]'); if (!b) return;
        UI.setBusy(b, true);
        try {
          const d = (await Api.call('exportData', { entity: b.dataset.export })).data;
          Csv.download(`laddoo-${b.dataset.export.toLowerCase()}_${Dates.today()}.csv`, d.headers, d.rows);
        } catch (err) { UI.toast(err.message, 'error'); } finally { UI.setBusy(b, false); }
      });
      $('#btn-test-conn').addEventListener('click', async (e) => {
        UI.setBusy(e.target, true);
        const t0 = performance.now();
        try {
          const res = await Api.call('ping');
          $('#health-output').innerHTML = `<p class="notice notice-info">Connected. Server version ${esc(res.data.version)}, server date ${Fmt.date(res.data.serverDate)}, answered in ${Math.round(performance.now() - t0)} ms.</p>`;
        } catch (err) { $('#health-output').innerHTML = UI.errorBlock(err); } finally { UI.setBusy(e.target, false); }
      });
      $('#btn-health').addEventListener('click', async (e) => {
        UI.setBusy(e.target, true);
        try {
          const res = await Api.call('checkData'), d = res.data;
          $('#health-output').innerHTML = `<dl class="kv">${Object.entries(d.counts).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${Fmt.qty(v)} rows</dd></div>`).join('')}</dl>` +
            (d.issues.length ? `<div class="notice notice-warn" style="margin-top:10px"><b>${d.issues.length} problem(s):</b><ul class="method-list">${d.issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`
              : '<p class="notice notice-info" style="margin-top:10px">Everything matches: no bill is overpaid and every payment belongs to a bill.</p>');
        } catch (err) { $('#health-output').innerHTML = UI.errorBlock(err); } finally { UI.setBusy(e.target, false); }
      });
    },
    show() {
      const s = State.settings;
      $('#info-list').innerHTML = [['Business name', s.businessName], ['Payment methods', s.paymentMethods.join(', ')],
        ['Items', State.products.map((p) => p.productName + (p.sellingPrice > 0 ? `: ${Fmt.inr(p.sellingPrice)}/piece${p.boxSize ? `, ${Fmt.inr(p.boxPrice)}/box of ${p.boxSize}` : ''}` : (p.boxSize ? ` (box of ${p.boxSize}, price typed on bill)` : ''))).join(' · ')],
        ['Currency · dates', 'INR (₹) · DD-MM-YYYY · Asia/Kolkata']]
        .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
    }
  };

  /* ===================== 8. Start-up ===================== */
  function start() {
    Router.register('dashboard', Dashboard);
    Router.register('record-sale', RecordSale);
    Router.register('sales', SalesHistory);
    Router.register('expenses', Expenses);
    Router.register('customers', Customers);
    Router.register('reports', Reports);
    Router.register('backup', Backup);
    Shell.init();
    AddNew.track();
    Payments.init();
    Cancel.init();
    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-view-sale]'); if (!a) return;
      e.preventDefault();
      SalesHistory.view(a.dataset.viewSale);
    });
    if (DEMO && window.LADDOO_DEMO_BANNER) { $('#demo-banner').innerHTML = window.LADDOO_DEMO_BANNER; $('#demo-banner').hidden = false; }
    Boot.enter();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();