/* =============================================================================
 * Millet Laddoo Business Manager — frontend configuration (config.js)
 *
 * This file is PUBLIC on GitHub Pages. The app has no login, so anyone who
 * knows the web app URL below can read and change your data. Do not share
 * the website link with people who should not edit your records.
 * ============================================================================= */
window.LADDOO_CONFIG = Object.freeze({
  // Paste your Apps Script web app URL (Deploy → Manage deployments → Web app URL).
  // It looks like: https://script.google.com/macros/s/AKfy.../exec
  API_URL: 'https://script.google.com/macros/s/AKfycbxu8UdSc9OmXj2c-0THyb6O_eliuRAq7_AZ50RwgtQ2A00k_7UGd0WTCEjcexeSn4fJ/exec',
  // ===== Items in the Record Sale drop-down =====
  // name: shown on the bill.  boxSize: pieces in one box (0 = not sold in boxes).
  // pricePerPiece / pricePerBox: 0 = the price box stays empty and you type it on each bill.
  PRODUCTS: [
    { name: 'Kambu',          pricePerPiece: 0, boxSize: 8, pricePerBox: 0 },
    { name: 'Karupu Ulunthu', pricePerPiece: 0, boxSize: 8, pricePerBox: 0 },
    { name: 'Peanut',         pricePerPiece: 0, boxSize: 8, pricePerBox: 0 },
    { name: 'Sesame',         pricePerPiece: 0, boxSize: 8, pricePerBox: 0 },
    { name: 'Ragi',           pricePerPiece: 0, boxSize: 8, pricePerBox: 0 },
    { name: 'Pasi Parupu',    pricePerPiece: 0, boxSize: 8, pricePerBox: 0 }
  ],

  APP_NAME: 'MILLET LADDOO BUSINESS MANAGER',
  CLIENT_VERSION: '3.0.0',
  REQUEST_TIMEOUT_MS: 30000,   // slower requests are reported as "result unknown, retry safely"
  PAGE_SIZE: 20,               // rows per page in tables
  LOCALE: 'en-IN',
  CURRENCY: 'INR',
  TIMEZONE: 'Asia/Kolkata',
  DEFAULT_DASHBOARD_RANGE: 'month'   // 'month' | '30d' | '7d' | 'today' | 'year'
});
