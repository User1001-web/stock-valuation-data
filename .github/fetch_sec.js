// Runs on GitHub Actions: reads your ticker list from the published Tickers tab,
// pulls each company's financials from SEC EDGAR, and writes data/raw_data.csv
// for the Google Sheet to read. Parsing uses the same code as the sheet (Code.gs).
const fs = require('fs'), path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8');
const mod = { exports: {} };
new Function('module', src)(mod);
const { parseCompany, RAW_COLS, parseCsv, TAGS } = mod.exports;

// Tags the parser reads; only these are saved in data/facts/ (for checking and debugging).
const USED = {};
Object.keys(TAGS).forEach(ns => {
  const set = new Set();
  Object.values(TAGS[ns]).forEach(v => [].concat(v).flat().forEach(t => set.add(t)));
  USED[ns] = set;
});
USED.dei = new Set(['EntityCommonStockSharesOutstanding']);

function compactFacts(facts, sub) {
  const out = { entityName: facts.entityName, facts: {} };
  Object.keys(USED).forEach(ns => {
    const src = (facts.facts || {})[ns]; if (!src) return;
    out.facts[ns] = {};
    Object.keys(src).forEach(tag => {
      if (!USED[ns].has(tag)) return;
      const units = {};
      Object.entries(src[tag].units || {}).forEach(([u, arr]) => {
        units[u] = arr.filter(f => f.end >= '2016-01-01')
          .map(f => (f.start ? { start: f.start, end: f.end, val: f.val, form: f.form, filed: f.filed } : { end: f.end, val: f.val, form: f.form, filed: f.filed }));
      });
      out.facts[ns][tag] = { units };
    });
  });
  const r = (sub && sub.filings && sub.filings.recent) || {};
  out.submissions = sub ? { name: sub.name, sic: sub.sic, sicDescription: sub.sicDescription,
    filings: { recent: { form: (r.form || []).slice(0, 40), filingDate: (r.filingDate || []).slice(0, 40) } } } : null;
  return out;
}

const EMAIL = (process.env.SEC_EMAIL || '').trim();
const LIST_URL = (process.env.TICKERS_CSV_URL || '').trim();
const OUT_DIR = process.env.OUT_DIR || path.join(__dirname, 'data');
const PAUSE_MS = 150;                       // SEC allows 10 requests/second
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function secJson(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': `StockValuationSheet ${EMAIL}`, 'Accept': 'application/json' } });
    if (res.ok) return res.json();
    if (res.status === 404) return null;
    if (res.status === 403 && attempt >= 1) throw Object.assign(new Error('SEC refused the request (403)'), { blocked: true });
    await sleep(2000 * (attempt + 1));
  }
  throw new Error(`SEC request failed for ${url}`);
}

async function loadTickers() {
  const res = await fetch(LIST_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Could not read the published Tickers CSV (HTTP ${res.status}). Check TICKERS_CSV_URL.`);
  const rows = parseCsv(await res.text());
  const seen = new Set(), out = [];
  rows.slice(1).forEach(r => {
    const t = String(r[0] || '').trim().toUpperCase();
    if (!t || seen.has(t) || !/^[A-Z0-9.\-]{1,12}$/.test(t)) return;
    seen.add(t);
    out.push({ ticker: t, market: (String(r[2] || '').trim() || 'US').toUpperCase() });
  });
  return out;
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function main() {
  if (!/@/.test(EMAIL)) throw new Error('Set the SEC_EMAIL secret to your email address.');
  if (!/^https:\/\//.test(LIST_URL)) throw new Error('Set the TICKERS_CSV_URL secret to the published Tickers CSV link.');

  const tickers = await loadTickers();
  console.log(`${tickers.length} tickers in the list`);
  const map = await secJson('https://www.sec.gov/files/company_tickers.json');
  await sleep(PAUSE_MS);
  const ciks = {};
  Object.values(map || {}).forEach(r => { const t = String(r.ticker).toUpperCase(); if (!(t in ciks)) ciks[t] = r.cik_str; });

  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const rows = [];
  for (const t of tickers) {
    let row;
    try {
      if (t.market === 'UK') row = { Ticker: t.ticker, Status: 'Skipped: UK listing (fundamentals come in a later stage)' };
      else if (t.market === 'ETF') row = { Ticker: t.ticker, Status: 'Skipped: ETF (not valued)' };
      else {
        const cik = ciks[t.ticker] || ciks[t.ticker.replace(/\./g, '-')];
        if (!cik) row = { Ticker: t.ticker, Status: 'No SEC filer found for this ticker' };
        else {
          const id = String(cik).padStart(10, '0');
          const facts = await secJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${id}.json`);
          await sleep(PAUSE_MS);
          const sub = await secJson(`https://data.sec.gov/submissions/CIK${id}.json`);
          await sleep(PAUSE_MS);
          if (facts) {
            fs.mkdirSync(path.join(OUT_DIR, 'facts'), { recursive: true });
            fs.writeFileSync(path.join(OUT_DIR, 'facts', t.ticker + '.json'), JSON.stringify(compactFacts(facts, sub)));
          }
          row = facts ? parseCompany(t.ticker, cik, facts, sub)
            : { Ticker: t.ticker, CIK: cik, Status: 'SEC has no XBRL financial data for this company' };
        }
      }
    } catch (err) {
      if (err.blocked) throw err;
      row = { Ticker: t.ticker, Status: 'Error: ' + err.message };
    }
    row.Updated = stamp;
    rows.push(row);
    console.log(`${t.ticker.padEnd(6)} ${row.Status}`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const lines = [RAW_COLS.map(csvCell).join(',')]
    .concat(rows.map(r => RAW_COLS.map(c => csvCell(r[c])).join(',')));
  fs.writeFileSync(path.join(OUT_DIR, 'raw_data.csv'), lines.join('\n') + '\n');
  const ok = rows.filter(r => r.Status === 'OK').length;
  console.log(`\nWrote ${rows.length} rows (${ok} OK) to raw_data.csv`);
}

main().catch(err => { console.error('FAILED: ' + err.message); process.exit(1); });
