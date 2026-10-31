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
  // Discovery: every tag name the company uses, plus debt-like balance-sheet facts.
  out.tagNames = {};
  const DEBTLIKE = /Debt|Borrowing|NotesPayable|SeniorNotes|LineOfCredit|Loans?Payable|Convertible/;
  Object.keys(facts.facts || {}).forEach(ns => {
    out.tagNames[ns] = Object.keys(facts.facts[ns]);
    if (ns === 'dei') return;
    Object.keys(facts.facts[ns]).forEach(tag => {
      if (!DEBTLIKE.test(tag) || (out.facts[ns] && out.facts[ns][tag])) return;
      const units = {};
      Object.entries(facts.facts[ns][tag].units || {}).forEach(([u, arr]) => {
        const inst = arr.filter(f => !f.start && f.end >= '2023-01-01').map(f => ({ end: f.end, val: f.val, form: f.form, filed: f.filed }));
        if (inst.length) units[u] = inst;
      });
      if (Object.keys(units).length) { out.facts[ns] = out.facts[ns] || {}; out.facts[ns][tag] = { units }; }
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
      if (t.market === 'UK') row = await ukRow(t.ticker);
      else if (EXCH[t.market]) row = await yahooRow(t.ticker, t.ticker + EXCH[t.market], 'YAHOO');
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
    if (row.CIK && /^\d+$/.test(String(row.CIK)) && /^Partial/.test(row.Status || '')) {
      const key = ['Revenue TTM', 'NetIncome TTM', 'OCF TTM'];
      if (key.some(k => row[k] === '' || row[k] === undefined)) {
        const y = await yahooRow(t.ticker, t.ticker.replace(/\./g, '-'), 'YAHOO');
        const filled = [];
        ['Revenue', 'NetIncome', 'OCF', 'Capex', 'GrossProfit', 'OperatingIncome'].forEach(fld => {
          [' TTM', ' TTM 1y ago', ' FY0', ' FY-1', ' FY-2', ' FY-3'].forEach(sfx => {
            const k = fld + sfx;
            if ((row[k] === '' || row[k] === undefined) && y[k] !== '' && y[k] !== undefined) { row[k] = y[k]; if (sfx === ' TTM') filled.push(fld); }
          });
        });
        if (filled.length) {
          const missing = ['Revenue TTM', 'NetIncome TTM', 'OCF TTM', 'Diluted shares latest', 'Cash', 'Equity'].filter(k => row[k] === '' || row[k] === undefined);
          row.Status = missing.length ? 'Partial: missing ' + missing.join(', ') : 'OK';
          row.Notes = (row.Notes ? row.Notes + '; ' : '') + filled.join(', ') + ' TTM from Yahoo (missing in SEC filings)';
        }
      }
    }
    const staleDays = row['Latest period end'] ? (Date.now() - Date.parse(row['Latest period end'])) / 864e5 : 0;
    if (t.market === 'US' && (/^(No SEC filer|SEC has no)/.test(row.Status || '') || staleDays > 456)) {
      const y = await yahooRow(t.ticker, t.ticker.replace(/\./g, '-'), 'YAHOO');
      if (y.Status === 'OK' || /^Partial/.test(y.Status || '')) { y.Notes = (y.Notes || '') + ' (SEC data missing or out of date)'; row = y; }
    }
    row.Updated = stamp;
    rows.push(row);
    console.log(`${t.ticker.padEnd(6)} ${row.Status}`);
  }

  await addYahoo(rows, tickers);
  await addEstimates(rows);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const lines = [RAW_COLS.map(csvCell).join(',')]
    .concat(rows.map(r => RAW_COLS.map(c => csvCell(r[c])).join(',')));
  fs.writeFileSync(path.join(OUT_DIR, 'raw_data.csv'), lines.join('\n') + '\n');
  // Bond yields from FRED (10-year Treasury, Moody's AAA corporate), for the sheet's discount rates.
  const rates = ['series,date,value'];
  for (const id of ['DGS10', 'AAA']) {
    try {
      const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`);
      const lines = (await res.text()).trim().split('\n').slice(1).filter(l => /,\d/.test(l));
      const last = lines[lines.length - 1].split(',');
      rates.push(`${id},${last[0]},${last[1]}`);
      console.log(`${id} ${last[0]} ${last[1]}%`);
    } catch (e) { console.log(`Could not fetch ${id} from FRED: ${e.message}`); }
  }
  if (rates.length > 1) fs.writeFileSync(path.join(OUT_DIR, 'rates.csv'), rates.join('\n') + '\n');
  const ok = rows.filter(r => r.Status === 'OK').length;
  console.log(`\nWrote ${rows.length} rows (${ok} OK) to raw_data.csv`);
}

// Yahoo symbol suffix per exchange code typed in the Tickers tab (column C).
const EXCH = { DE: '.DE', FR: '.PA', NL: '.AS', CH: '.SW', IT: '.MI', ES: '.MC', SE: '.ST', DK: '.CO', NO: '.OL', FI: '.HE', BE: '.BR', IE: '.IR' };

// UK listings: annual statements and trailing-12-month figures from Yahoo Finance, mapped to
// the same Raw Data columns as SEC companies. Balance sheet from the latest annual report.
let yfInstance = null;
async function yahoo() {
  if (yfInstance) return yfInstance;
  const YF = (await import('yahoo-finance2')).default;
  yfInstance = typeof YF === 'function' ? new YF({ suppressNotices: ['yahooSurvey', 'ripHistorical'] }) : YF;
  return yfInstance;
}
const UK_MAP = {
  Revenue: ['totalRevenue', 'operatingRevenue'], GrossProfit: ['grossProfit'], OperatingIncome: ['operatingIncome', 'EBIT'],
  NetIncome: ['netIncomeCommonStockholders', 'netIncome'], PretaxIncome: ['pretaxIncome'], IncomeTax: ['taxProvision'],
  InterestExpense: ['interestExpense'], OCF: ['operatingCashFlow'], Capex: ['capitalExpenditure'], SBC: ['stockBasedCompensation'],
  DA: ['reconciledDepreciation', 'depreciationAndAmortization'], DividendsPaid: ['cashDividendsPaid', 'commonStockDividendPaid'],
  Buybacks: ['repurchaseOfCapitalStock'], EPS: ['dilutedEPS', 'basicEPS'], DilutedShares: ['dilutedAverageShares', 'basicAverageShares']
};
const POSITIVE = new Set(['Capex', 'DividendsPaid', 'Buybacks']);   // Yahoo reports these as negative cash flows
function ukVal(rec, field) {
  if (!rec) return '';
  for (const k of UK_MAP[field]) {
    const v = rec[k];
    if (typeof v === 'number' && isFinite(v)) return POSITIVE.has(field) ? Math.abs(v) : v;
  }
  return '';
}
const isoOf = d => (typeof d === 'number' ? new Date(d * (d < 1e11 ? 1000 : 1)) : new Date(d)).toISOString().slice(0, 10);
async function ukRow(ticker) { return yahooRow(ticker, ticker + '.L', 'LSE'); }
async function yahooRow(ticker, sym, idTag) {
  const yf = await yahoo();
  const row = { Ticker: ticker, CIK: idTag, 'Filer form': idTag === 'LSE' ? 'Yahoo Finance (LSE)' : 'Yahoo Finance', Accounting: idTag === 'LSE' ? 'IFRS' : '' };
  try {
    const qs = await yf.quoteSummary(sym, { modules: ['assetProfile', 'price', 'financialData'] }, { validateResult: false });
    await sleep(300);
    const qt = String((qs.price && qs.price.quoteType) || '').toUpperCase();
    if (qt === 'ETF' || qt === 'MUTUALFUND') return { Ticker: ticker, Status: 'Skipped: ETF (not valued)' };
    const annual = (await yf.fundamentalsTimeSeries(sym, { period1: '2019-01-01', type: 'annual', module: 'all' }, { validateResult: false }))
      .map(r => Object.assign({}, r, { iso: isoOf(r.date) })).sort((a, b) => (a.iso < b.iso ? 1 : -1));
    await sleep(300);
    const trailing = (await yf.fundamentalsTimeSeries(sym, { period1: '2023-01-01', type: 'trailing', module: 'all' }, { validateResult: false }))
      .map(r => Object.assign({}, r, { iso: isoOf(r.date) })).sort((a, b) => (a.iso < b.iso ? 1 : -1));
    await sleep(300);
    if (!annual.length) return { Ticker: ticker, Status: idTag === 'LSE' ? 'No UK financial data on Yahoo Finance' : 'No SEC or Yahoo financial data' };
    row['SEC name'] = (qs.price && qs.price.longName) || '';
    row.Industry = (qs.assetProfile && qs.assetProfile.industry) || '';
    row['Yahoo industry'] = row.Industry;
    row.Sector = (qs.assetProfile && qs.assetProfile.sector) || '';
    row.Currency = (qs.financialData && qs.financialData.financialCurrency) || 'GBP';

    const fy0 = annual[0], fy1 = annual[1];
    const day = s => Date.parse(s) / 864e5;
    // Use the latest trailing record if it is newer than the last annual report (adds half-year results).
    const t0 = trailing.find(r => typeof r.netIncomeCommonStockholders === 'number' || typeof r.totalRevenue === 'number');
    const useT = t0 && day(t0.iso) > day(fy0.iso) + 30;
    const latest = useT ? t0 : fy0;
    const prev = useT ? trailing.find(r => Math.abs(day(r.iso) - (day(t0.iso) - 365)) <= 45) || null : fy1;
    row['Latest period end'] = latest.iso;
    row['Latest FY end'] = fy0.iso;
    row['Last filed'] = '';
    ['Revenue', 'GrossProfit', 'OperatingIncome', 'NetIncome', 'PretaxIncome', 'IncomeTax', 'InterestExpense', 'OCF', 'Capex', 'SBC', 'DA', 'DividendsPaid', 'Buybacks']
      .forEach(f => {
        let v = ukVal(latest, f); if (v === '' && useT) v = ukVal(fy0, f);
        row[f + ' TTM'] = v;
        let p = ukVal(prev, f);
        if (p === '' && useT) p = ukVal(fy0, f);    // no trailing record a year back: compare with last annual report
        if (p === '' && !useT) p = ukVal(fy1, f);
        row[f + ' TTM 1y ago'] = p;
      });
    row['EPS TTM'] = ukVal(latest, 'EPS'); row['EPS TTM 1y ago'] = ukVal(prev, 'EPS');
    row['Diluted shares latest'] = ukVal(latest, 'DilutedShares') || ukVal(fy0, 'DilutedShares');
    row['Diluted shares 1y ago'] = ukVal(prev, 'DilutedShares') || ukVal(fy1, 'DilutedShares');
    row['Shares outstanding'] = typeof fy0.ordinarySharesNumber === 'number' ? fy0.ordinarySharesNumber : '';
    row.Cash = typeof fy0.cashAndCashEquivalents === 'number' ? fy0.cashAndCashEquivalents : '';
    row['Short-term investments'] = typeof fy0.otherShortTermInvestments === 'number' ? fy0.otherShortTermInvestments : 0;
    row['Total debt'] = typeof fy0.totalDebt === 'number' ? fy0.totalDebt : 0;
    const eq = r => (r ? (typeof r.commonStockEquity === 'number' ? r.commonStockEquity : typeof r.stockholdersEquity === 'number' ? r.stockholdersEquity : '') : '');
    row.Equity = eq(fy0); row['Equity 1y ago'] = eq(fy1);
    row['Balance sheet date'] = fy0.iso;
    const H = { Revenue: 1, GrossProfit: 1, OperatingIncome: 1, NetIncome: 1, OCF: 1, Capex: 1, SBC: 1, EPS: 1, DilutedShares: 1, DividendsPaid: 1 };
    Object.keys(H).forEach(f => { for (let i = 0; i <= 5; i++) row[f + ' FY' + (i === 0 ? '0' : '-' + i)] = ukVal(annual[i], f); });
    const need = ['NetIncome TTM', 'Diluted shares latest', 'Equity'];
    const missing = need.filter(k => row[k] === '' || row[k] === undefined);
    row.Status = missing.length ? 'Partial: missing ' + missing.join(', ') : 'OK';
    row.Notes = (idTag === 'LSE' ? 'UK figures' : 'Figures') + ' from Yahoo Finance' + (useT ? ' (trailing 12 months incl. half-year results)' : ' (annual)');
  } catch (e) {
    return { Ticker: ticker, Status: 'Error: Yahoo data ' + String(e.message).slice(0, 120) };
  }
  return row;
}

// Analyst targets and current/next fiscal-year estimates from Yahoo Finance (unofficial, via the
// yahoo-finance2 package). Covers nearly all US and UK listings; FMP fills any gaps.
async function addYahoo(rows, tickers) {
  let yf;
  try { yf = await yahoo(); } catch (e) { console.log('Yahoo library not available: ' + e.message); return; }
  const market = {};
  tickers.forEach(t => { market[t.ticker] = t.market; });
  let ok = 0, fail = 0;
  for (const r of rows) {
    const m = market[r.Ticker] || 'US';
    if (m === 'ETF') continue;
    const sym = m === 'UK' ? r.Ticker.replace(/\.$/, '') + '.L' : EXCH[m] ? r.Ticker + EXCH[m] : r.Ticker.replace(/\./g, '-');
    try {
      const q = await yf.quoteSummary(sym, { modules: ['financialData', 'earningsTrend', 'assetProfile', 'calendarEvents', 'earningsHistory'] }, { validateResult: false });
      // Earnings calendar, last surprise and estimate revisions (next fiscal year EPS)
      const ce = (q.calendarEvents && q.calendarEvents.earnings) || {};
      const nextDates = (ce.earningsDate || []).map(x => new Date(x)).filter(x => !isNaN(x)).sort((a, b) => a - b);
      if (nextDates.length) r['Next earnings'] = nextDates[0].toISOString().slice(0, 10) + (ce.isEarningsDateEstimate ? ' (est.)' : '');
      const hist = ((q.earningsHistory && q.earningsHistory.history) || []).filter(h => h.quarter && typeof h.surprisePercent === 'number')
        .sort((a, b) => new Date(b.quarter) - new Date(a.quarter));
      if (hist.length) { r['Last EPS surprise'] = hist[0].surprisePercent; r['Last earnings quarter'] = new Date(hist[0].quarter).toISOString().slice(0, 10); }
      const trend = ((q.earningsTrend && q.earningsTrend.trend) || []).find(t => t.period === '+1y') || {};
      const et = trend.epsTrend || {}, er = trend.epsRevisions || {};
      if (typeof et.current === 'number') {
        r['EPS est now'] = et.current;
        if (typeof et['30daysAgo'] === 'number') r['EPS est 30d ago'] = et['30daysAgo'];
        if (typeof et['90daysAgo'] === 'number') r['EPS est 90d ago'] = et['90daysAgo'];
      }
      if (typeof er.upLast30days === 'number') r['Revisions up 30d'] = er.upLast30days;
      if (typeof er.downLast30days === 'number') r['Revisions down 30d'] = er.downLast30days;
      const fd = q.financialData || {}, tr = (q.earningsTrend && q.earningsTrend.trend) || [];
      const ap = q.assetProfile || {};
      if (ap.sector) r.Sector = ap.sector;
      if (ap.industry) r['Yahoo industry'] = ap.industry;
      const y0 = tr.find(t => t.period === '0y') || {}, y1 = tr.find(t => t.period === '+1y') || {};
      const d = x => (x ? new Date(x).toISOString().slice(0, 10) : '');
      if (fd.currentPrice) r['Yahoo price'] = fd.currentPrice;
      if (fd.targetMeanPrice) {
        r['Target consensus'] = fd.targetMeanPrice; r['Target high'] = fd.targetHighPrice || ''; r['Target low'] = fd.targetLowPrice || '';
        r['Est analysts'] = fd.numberOfAnalystOpinions || '';
      }
      const rev1 = y1.revenueEstimate && y1.revenueEstimate.avg;
      if (rev1 > 0) {
        r['Est FY1 end'] = d(y0.endDate); r['Est FY2 end'] = d(y1.endDate);
        r['Est revenue FY1'] = (y0.revenueEstimate && y0.revenueEstimate.avg) || ''; r['Est revenue FY2'] = rev1;
        r['Est EPS FY1'] = (y0.earningsEstimate && y0.earningsEstimate.avg) ?? ''; r['Est EPS FY2'] = (y1.earningsEstimate && y1.earningsEstimate.avg) ?? '';
        r['Est source'] = 'Yahoo';
      }
      ok++;
    } catch (e) { fail++; }
    await sleep(400);
  }
  console.log(`Yahoo: ${ok} answered, ${fail} failed`);
}

// Analyst estimates and price targets from Financial Modeling Prep (free key, limited coverage).
// Covered tickers are re-checked weekly (Sundays) or when the coverage list is missing,
// so daily calls stay well inside the free 250/day limit.
async function addEstimates(rows) {
  const KEY = (process.env.FMP_KEY || '').trim();
  if (!KEY) { console.log('No FMP_KEY secret: skipping analyst estimates'); return; }
  const covFile = path.join(OUT_DIR, 'fmp_coverage.csv');
  const us = rows.filter(r => r.CIK && r['Latest FY end']);
  let covered = null;
  if (fs.existsSync(covFile) && new Date().getUTCDay() !== 0) {
    covered = new Set(fs.readFileSync(covFile, 'utf8').split('\n').slice(1).filter(l => l.endsWith(',200')).map(l => l.split(',')[0]));
  }
  const status = [];
  let calls = 0;
  for (const r of us) {
    if (r['Est revenue FY2'] && r['Target consensus']) continue;           // Yahoo already supplied it
    if (covered && !covered.has(r.Ticker)) { status.push(`${r.Ticker},402`); continue; }
    if (calls > 230) { status.push(`${r.Ticker},skipped`); continue; }
    try {
      const res = await fetch(`https://financialmodelingprep.com/stable/analyst-estimates?symbol=${r.Ticker}&period=annual&page=0&limit=10&apikey=${KEY}`);
      calls++;
      status.push(`${r.Ticker},${res.status}`);
      if (res.status !== 200) continue;
      const est = (await res.json()).sort((a, b) => (a.date < b.date ? -1 : 1));
      const fy0 = Date.parse(r['Latest FY end']);
      const fwd = est.filter(e => Date.parse(e.date) > fy0 + 20 * 864e5);
      if (fwd.length >= 2 && !r['Est revenue FY2']) {
        r['Est FY1 end'] = fwd[0].date; r['Est FY2 end'] = fwd[1].date; r['Est source'] = 'FMP';
        r['Est revenue FY1'] = fwd[0].revenueAvg; r['Est revenue FY2'] = fwd[1].revenueAvg;
        r['Est EPS FY1'] = fwd[0].epsAvg; r['Est EPS FY2'] = fwd[1].epsAvg;
        r['Est analysts'] = fwd[0].numAnalystsRevenue || '';
      }
      const t = await fetch(`https://financialmodelingprep.com/stable/price-target-consensus?symbol=${r.Ticker}&apikey=${KEY}`);
      calls++;
      if (t.status === 200 && !r['Target consensus']) {
        const p = (await t.json())[0] || {};
        r['Target consensus'] = p.targetConsensus || ''; r['Target high'] = p.targetHigh || ''; r['Target low'] = p.targetLow || '';
      }
    } catch (e) { status.push(`${r.Ticker},error`); }
    await sleep(200);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(covFile, 'ticker,status\n' + status.join('\n') + '\n');
  console.log(`Analyst estimates: ${rows.filter(r => r['Est revenue FY2']).length} tickers (${calls} FMP calls)`);
}

main().catch(err => { console.error('FAILED: ' + err.message); process.exit(1); });
