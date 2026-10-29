/**
 * Stock Valuation Model — Stage 1: data layer
 *
 * What this script does
 *  - Keeps the "Market" tab in step with your Tickers and Holdings tabs
 *    (one row of GOOGLEFINANCE formulas per ticker, added/removed automatically).
 *  - Every hour, reads data/raw_data.csv from your GitHub repository into the
 *    "Raw Data" tab. That file is rebuilt daily by a GitHub job (fetch_sec.js),
 *    because the SEC refuses requests coming from Google's servers.
 *    Raw Data holds trailing-12-month figures, the same a year earlier,
 *    balance-sheet items and 6 years of annual history per company.
 *  - The same file also runs on GitHub: the parsing functions below are shared.
 *
 * Menu: Valuation ▸ First-time setup   (run once after pasting this script)
 */

var SHEET = {
  TICKERS: 'Tickers', HOLDINGS: 'Holdings', ASSUME: 'Assumptions',
  MARKET: 'Market', RAW: 'Raw Data', LOG: 'Log'
};
var DAY = 86400000;

/* ------------------------------------------------------------------------ */
/*  Field maps: which XBRL tags feed each field, in priority order          */
/* ------------------------------------------------------------------------ */

var FLOW_FIELDS = ['Revenue', 'GrossProfit', 'OperatingIncome', 'NetIncome', 'PretaxIncome',
  'IncomeTax', 'InterestExpense', 'OCF', 'Capex', 'SBC', 'DA', 'DividendsPaid', 'Buybacks'];

var HISTORY_FIELDS = ['Revenue', 'GrossProfit', 'OperatingIncome', 'NetIncome', 'OCF', 'Capex',
  'SBC', 'EPS', 'DilutedShares', 'DividendsPaid'];

var TAGS = {
  'us-gaap': {
    Revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet',
      'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueGoodsNet',
      'SalesRevenueServicesNet', 'RevenuesNetOfInterestExpense', 'GrossInvestmentIncomeOperating',
      'InvestmentIncomeInterestAndDividend'],
    CostOfRevenue: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold', 'CostOfServices'],
    GrossProfit: ['GrossProfit'],
    OperatingIncome: ['OperatingIncomeLoss'],
    NetIncome: ['NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic', 'ProfitLoss'],
    PretaxIncome: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
      'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments',
      'IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic'],
    IncomeTax: ['IncomeTaxExpenseBenefit'],
    InterestExpense: ['InterestExpense', 'InterestExpenseNonoperating', 'InterestExpenseDebt',
      'InterestPaidNet'],
    OCF: ['NetCashProvidedByUsedInOperatingActivities',
      'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
    Capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets',
      'PaymentsForCapitalImprovements'],
    SBC: ['ShareBasedCompensation', 'AllocatedShareBasedCompensationExpense'],
    DA: ['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization',
      'DepreciationAmortizationAndAccretionNet', 'Depreciation'],
    DividendsPaid: ['PaymentsOfDividends', 'PaymentsOfDividendsCommonStock'],
    Buybacks: ['PaymentsForRepurchaseOfCommonStock'],
    EPS: ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted', 'EarningsPerShareBasic'],
    DilutedShares: ['WeightedAverageNumberOfDilutedSharesOutstanding',
      'WeightedAverageNumberOfShareOutstandingBasicAndDiluted', 'WeightedAverageNumberOfSharesOutstandingBasic'],
    Cash: ['CashAndCashEquivalentsAtCarryingValue',
      'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'Cash'],
    ShortTermInvestments: ['ShortTermInvestments', 'MarketableSecuritiesCurrent',
      'AvailableForSaleSecuritiesDebtSecuritiesCurrent'],
    Equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
    SharesOutstanding: ['CommonStockSharesOutstanding'],
    // Debt: the first group with a value at the latest balance-sheet date is used.
    DebtGroups: [
      ['LongTermDebt'],
      ['LongTermDebtNoncurrent', 'LongTermDebtCurrent'],
      ['DebtLongtermAndShorttermCombinedAmount'],
      ['LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities'],
      ['LongTermDebtAndCapitalLeaseObligations', 'LongTermDebtAndCapitalLeaseObligationsCurrent'],
      ['DebtAndCapitalLeaseObligations'],
      ['LongTermNotesPayable', 'NotesPayableCurrent'],
      ['NotesPayable'],
      ['SeniorLongTermNotes'],
      ['ConvertibleNotesPayable', 'ConvertibleNotesPayableCurrent'],
      ['ConvertibleDebtNoncurrent', 'ConvertibleDebtCurrent'],
      ['ConvertibleSeniorNotesNoncurrent'],
      ['UnsecuredDebt'],
      ['SecuredDebt'],
      ['DebtInstrumentCarryingAmount'],
      ['OtherLongTermDebtNoncurrent', 'OtherLongTermDebtCurrent'],
      ['LongTermLineOfCredit'],
      ['DebtCurrent']
    ],
    DebtExtras: ['ShortTermBorrowings', 'CommercialPaper']
  },
  'ifrs-full': {
    Revenue: ['Revenue', 'RevenueFromContractsWithCustomers'],
    CostOfRevenue: ['CostOfSales'],
    GrossProfit: ['GrossProfit'],
    OperatingIncome: ['ProfitLossFromOperatingActivities'],
    NetIncome: ['ProfitLossAttributableToOwnersOfParent', 'ProfitLoss'],
    PretaxIncome: ['ProfitLossBeforeTax'],
    IncomeTax: ['IncomeTaxExpenseContinuingOperations'],
    InterestExpense: ['FinanceCosts', 'InterestExpense'],
    OCF: ['CashFlowsFromUsedInOperatingActivities'],
    Capex: ['PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities',
      'PurchaseOfPropertyPlantAndEquipment'],
    SBC: ['AdjustmentsForSharebasedPayments', 'ExpenseFromSharebasedPaymentTransactionsWithEmployees'],
    DA: ['DepreciationAndAmortisationExpense', 'AdjustmentsForDepreciationAndAmortisationExpense'],
    DividendsPaid: ['DividendsPaidClassifiedAsFinancingActivities', 'DividendsPaid'],
    Buybacks: ['PaymentsToAcquireOrRedeemEntitysShares'],
    EPS: ['DilutedEarningsLossPerShare', 'BasicAndDilutedEarningsLossPerShare', 'BasicEarningsLossPerShare'],
    DilutedShares: ['AdjustedWeightedAverageShares', 'WeightedAverageShares'],
    Cash: ['CashAndCashEquivalents'],
    ShortTermInvestments: ['CurrentInvestments', 'ShorttermInvestments'],
    Equity: ['EquityAttributableToOwnersOfParent', 'Equity'],
    SharesOutstanding: ['NumberOfSharesOutstanding'],
    DebtGroups: [
      ['Borrowings'],
      ['NoncurrentPortionOfNoncurrentBorrowings', 'CurrentPortionOfNoncurrentBorrowings'],
      ['LongtermBorrowings', 'CurrentPortionOfLongtermBorrowings']
    ],
    DebtExtras: ['ShorttermBorrowings']
  }
};

/* Raw Data column order. Stage 2 formulas find columns by these header names. */
var RAW_COLS = (function () {
  var c = ['Ticker', 'Status', 'Updated', 'CIK', 'SEC name', 'SIC', 'Industry', 'Filer form',
    'Accounting', 'Currency', 'Latest period end', 'Latest FY end', 'Last filed'];
  FLOW_FIELDS.forEach(function (f) { c.push(f + ' TTM'); });
  FLOW_FIELDS.forEach(function (f) { c.push(f + ' TTM 1y ago'); });
  c.push('EPS TTM', 'EPS TTM 1y ago', 'Diluted shares latest', 'Diluted shares 1y ago',
    'Shares outstanding', 'Cash', 'Short-term investments', 'Total debt', 'Equity',
    'Equity 1y ago', 'Balance sheet date');
  HISTORY_FIELDS.forEach(function (f) {
    for (var i = 0; i <= 5; i++) c.push(f + ' FY' + (i === 0 ? '0' : '-' + i));
  });
  c.push('Notes');
  return c;
})();

/* ------------------------------------------------------------------------ */
/*  Menu, setup, triggers                                                    */
/* ------------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Valuation')
    .addItem('First-time setup', 'setup')
    .addSeparator()
    .addItem('Load latest data from GitHub now', 'refreshFundamentals')
    .addItem('Rebuild Market tab', 'rebuildMarket')
    .addToUi();
}

/** Simple trigger: keeps the Market tab in step when you edit ticker lists. */
function onEdit(e) {
  try {
    var name = e.range.getSheet().getName();
    if ((name === SHEET.TICKERS || name === SHEET.HOLDINGS) && e.range.getColumn() <= 2) syncMarket_();
  } catch (err) { /* never block an edit */ }
}

function setup() {
  var ss = SpreadsheetApp.getActive();
  [SHEET.TICKERS, SHEET.HOLDINGS, SHEET.ASSUME].forEach(function (n) {
    if (!ss.getSheetByName(n)) throw new Error('Tab "' + n + '" is missing. Import the workbook first.');
  });
  ensureSheet_(SHEET.MARKET, MARKET_HEADERS);
  ensureSheet_(SHEET.RAW, RAW_COLS);
  ensureSheet_(SHEET.LOG, ['Time', 'Ticker', 'Message']);
  ss.getSheetByName(SHEET.RAW).setFrozenColumns(1);

  nameSetting_('GitHub data URL', 'GITHUB_URL',
    'Link to data/raw_data.csv in your GitHub repository (raw.githubusercontent.com/...). See Start here.');
  var fx = nameSetting_('USD to GBP rate', 'FX_USDGBP', 'Live GOOGLEFINANCE rate.');
  fx.setFormula('=GOOGLEFINANCE("CURRENCY:USDGBP")');

  writeTickerFormulas_();
  writeHoldingsFormulas_();
  rebuildMarket();

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshFundamentals') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshFundamentals').timeBased().everyHours(1).create();

  if (!getNamed_('GITHUB_URL')) {
    SpreadsheetApp.getUi().alert('Setup done. Once your GitHub job has run, paste the raw_data.csv link next to ' +
      '"GitHub data URL" on the Assumptions tab, then choose Valuation ▸ Load latest data from GitHub now.');
    return;
  }
  refreshFundamentals();
  SpreadsheetApp.getActive().toast('Setup done. Data loaded; it reloads hourly in the background.', 'Valuation', 8);
}

/** Names the value cell next to a label on Assumptions, adding the row if it is missing. */
function nameSetting_(label, rangeName, note) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET.ASSUME);
  var labels = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues();
  var row = 0;
  for (var i = 0; i < labels.length; i++) {
    if (String(labels[i][0]).trim() === label) { row = i + 1; break; }
  }
  if (!row) {
    row = sh.getLastRow() + 1;
    sh.getRange(row, 1, 1, 3).setValues([[label, '', note || '']]);
  }
  var cell = sh.getRange(row, 2);
  SpreadsheetApp.getActive().setNamedRange(rangeName, cell);
  return cell;
}

function ensureSheet_(name, headers) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}

/* Tickers: column D shows whether each ticker is held or watched. */
function writeTickerFormulas_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET.TICKERS);
  sh.getRange('D2').setFormula('=ARRAYFORMULA(IF(A2:A="",,IF(COUNTIF(Holdings!A2:A,A2:A)>0,"Holding","Watchlist")))');
}

/* Holdings: everything right of "Avg cost (£)" is formulas. */
function writeHoldingsFormulas_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET.HOLDINGS);
  var f = {
    F2: '=ARRAYFORMULA(IF(A2:A="",,D2:D*E2:E))',
    G2: '=ARRAYFORMULA(IF(A2:A="",,IFERROR(VLOOKUP(A2:A,Market!A2:E,4,FALSE),)))',
    H2: '=ARRAYFORMULA(IF(A2:A="",,IFERROR(VLOOKUP(A2:A,Market!A2:E,5,FALSE),)))',
    I2: '=ARRAYFORMULA(IF(A2:A="",,IF(G2:G="",,IF(H2:H="GBX",G2:G/100,IF(H2:H="USD",G2:G*FX_USDGBP,G2:G)))))',
    J2: '=ARRAYFORMULA(IF(A2:A="",,IF(I2:I="",,D2:D*I2:I)))',
    K2: '=ARRAYFORMULA(IF(A2:A="",,IF(J2:J="",,J2:J-F2:F)))',
    L2: '=ARRAYFORMULA(IF(A2:A="",,IF(J2:J="",,J2:J/F2:F-1)))',
    M2: '=ARRAYFORMULA(IF(A2:A="",,IF(J2:J="",,J2:J/SUM(J2:J))))'
  };
  Object.keys(f).forEach(function (a1) { sh.getRange(a1).setFormula(f[a1]); });
}

/* ------------------------------------------------------------------------ */
/*  Market tab (GOOGLEFINANCE)                                               */
/* ------------------------------------------------------------------------ */

var MARKET_HEADERS = ['Ticker', 'Google symbol', 'Name', 'Price', 'Currency', 'Market cap', 'Shares',
  'Beta', 'P/E', 'EPS', '52w high', '52w low', '200-day avg', 'Price vs 200-day'];

function marketFormulas_(r) {
  var s = '$B' + r;
  return [
    '=IF(IFERROR(VLOOKUP($A' + r + ',Tickers!$A:$B,2,FALSE),"")="",$A' + r + ',VLOOKUP($A' + r + ',Tickers!$A:$B,2,FALSE))',
    '=IFERROR(GOOGLEFINANCE(' + s + ',"name"),"")',
    '=IFERROR(GOOGLEFINANCE(' + s + ',"price"),"")',
    '=IFERROR(GOOGLEFINANCE(' + s + ',"currency"),"")',
    '=IFERROR(GOOGLEFINANCE(' + s + ',"marketcap"),"")',
    '=IFERROR(GOOGLEFINANCE(' + s + ',"shares"),"")',
    '=IFERROR(GOOGLEFINANCE(' + s + ',"beta"),"")',
    '=IFERROR(GOOGLEFINANCE(' + s + ',"pe"),"")',
    '=IFERROR(GOOGLEFINANCE(' + s + ',"eps"),"")',
    '=IFERROR(GOOGLEFINANCE(' + s + ',"high52"),"")',
    '=IFERROR(GOOGLEFINANCE(' + s + ',"low52"),"")',
    '=IFERROR(AVERAGE(QUERY(GOOGLEFINANCE(' + s + ',"close",TODAY()-300,TODAY()),"select Col2 order by Col1 desc limit 200",1)),"")',
    '=IFERROR(D' + r + '/M' + r + '-1,"")'
  ];
}

function rebuildMarket() {
  var sh = ensureSheet_(SHEET.MARKET, MARKET_HEADERS);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  syncMarket_();
}

/** Adds Market rows for new tickers and removes rows for tickers no longer listed. */
function syncMarket_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SHEET.MARKET);
  if (!sh) return;
  var wanted = allTickers_().map(function (t) { return t.ticker; });
  var have = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]).trim(); }) : [];
  for (var i = have.length - 1; i >= 0; i--) {
    if (!have[i] || wanted.indexOf(have[i]) < 0) { sh.deleteRow(i + 2); have.splice(i, 1); }
  }
  var add = wanted.filter(function (t) { return have.indexOf(t) < 0; });
  if (!add.length) return;
  var start = have.length + 2;
  sh.getRange(start, 1, add.length, 1).setValues(add.map(function (t) { return [t]; }));
  sh.getRange(start, 2, add.length, MARKET_HEADERS.length - 1)
    .setFormulas(add.map(function (_, k) { return marketFormulas_(start + k); }));
}

/** Tickers tab plus anything on Holdings that isn't on Tickers yet (added to Tickers). */
function allTickers_() {
  var ss = SpreadsheetApp.getActive();
  var tk = ss.getSheetByName(SHEET.TICKERS);
  var rows = tk.getLastRow() > 1 ? tk.getRange(2, 1, tk.getLastRow() - 1, 3).getValues() : [];
  var list = [], seen = {};
  rows.forEach(function (r) {
    var t = String(r[0]).trim().toUpperCase();
    if (!t || seen[t]) return;
    seen[t] = 1;
    list.push({ ticker: t, symbol: String(r[1]).trim(), market: (String(r[2]).trim() || 'US').toUpperCase() });
  });
  var h = ss.getSheetByName(SHEET.HOLDINGS);
  var held = h.getLastRow() > 1 ? h.getRange(2, 1, h.getLastRow() - 1, 1).getValues() : [];
  var missing = [];
  held.forEach(function (r) {
    var t = String(r[0]).trim().toUpperCase();
    if (t && !seen[t]) { seen[t] = 1; missing.push(t); list.push({ ticker: t, symbol: '', market: 'US' }); }
  });
  if (missing.length) {
    tk.getRange(tk.getLastRow() + 1, 1, missing.length, 1).setValues(missing.map(function (t) { return [t]; }));
  }
  return list;
}

/* ------------------------------------------------------------------------ */
/*  Refresh runs                                                             */
/* ------------------------------------------------------------------------ */

/** Hourly trigger + menu: loads the latest raw_data.csv from GitHub into Raw Data. */
function refreshFundamentals() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(2000)) return;            // another run is in progress
  try {
    var tickers = allTickers_();
    syncMarket_();
    var url = String(getNamed_('GITHUB_URL') || '').trim();
    if (!/^https:\/\//.test(url)) { log_('', 'Waiting: paste the raw_data.csv link next to "GitHub data URL" on Assumptions.'); return; }

    var res = UrlFetchApp.fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      log_('', 'Could not read the GitHub data file (HTTP ' + res.getResponseCode() + '). Check the GitHub data URL.');
      return;
    }
    var csv = Utilities.parseCsv(res.getContentText());
    var result = buildRawRows(csv, tickers.map(function (t) { return t.ticker; }));

    var sh = SpreadsheetApp.getActive().getSheetByName(SHEET.RAW);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
    if (result.rows.length) sh.getRange(2, 1, result.rows.length, RAW_COLS.length).setValues(result.rows);

    var prev = PropertiesService.getDocumentProperties().getProperty('LAST_STAMP');
    if (result.stamp !== prev) {
      PropertiesService.getDocumentProperties().setProperty('LAST_STAMP', result.stamp);
      log_('', 'Loaded GitHub data from ' + result.stamp + ': ' + result.ok + ' OK, ' +
        (result.rows.length - result.ok) + ' partial or skipped' +
        (result.waiting ? ', ' + result.waiting + ' new ticker(s) waiting for the next GitHub run' : '') + '.');
    }
    if (result.ageDays > 3) log_('', 'Warning: the GitHub data is ' + Math.round(result.ageDays) +
      ' days old. Check the Actions tab of your repository (scheduled runs can be paused there).');
  } finally {
    lock.releaseLock();
  }
}

/**
 * Turns the GitHub CSV into Raw Data rows for the tickers currently listed.
 * Numbers become numbers; tickers not in the file yet get a "waiting" status.
 */
function buildRawRows(csv, tickers) {
  var head = csv[0] || [], idx = {};
  head.forEach(function (h, i) { idx[h] = i; });
  var byTicker = {};
  csv.slice(1).forEach(function (r) { if (r[idx.Ticker]) byTicker[String(r[idx.Ticker]).toUpperCase()] = r; });
  var ok = 0, waiting = 0, stamp = '';
  var rows = tickers.map(function (t) {
    var src = byTicker[t];
    if (!src) { waiting++; return RAW_COLS.map(function (c) { return c === 'Ticker' ? t : c === 'Status' ? 'Waiting for the next GitHub run (added recently)' : ''; }); }
    if (src[idx.Status] === 'OK') ok++;
    if (src[idx.Updated] && src[idx.Updated] > stamp) stamp = src[idx.Updated];
    return RAW_COLS.map(function (c) {
      var v = idx[c] === undefined ? '' : src[idx[c]];
      if (c === 'Ticker' || c === 'CIK' || c === 'SIC') return v;
      return /^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(v) ? Number(v) : v;
    });
  });
  var ageDays = stamp ? (Date.now() - Date.parse(stamp.replace(' UTC', 'Z').replace(' ', 'T'))) / DAY : 0;
  return { rows: rows, ok: ok, waiting: waiting, stamp: stamp, ageDays: ageDays };
}

/** CSV parser (quotes, commas and line breaks inside quotes). Used by the GitHub job. */
function parseCsv(text) {
  var rows = [], row = [], cell = '', q = false;
  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/* ------------------------------------------------------------------------ */
/*  Parsing SEC companyfacts → one Raw Data row                              */
/*  (pure functions: no Sheets calls, so they can be tested outside Google)  */
/* ------------------------------------------------------------------------ */

function dnum_(iso) { return Math.round(Date.parse(iso + 'T00:00:00Z') / DAY); }
function durDays_(f) { return dnum_(f.end) - dnum_(f.start); }
function isAnnual_(f) { return f.dur >= 340 && f.dur <= 390; }

function pickUnit_(units, kind, ccy) {
  var keys = Object.keys(units || {});
  if (kind === 'shares') return keys.indexOf('shares') >= 0 ? 'shares' : null;
  if (kind === 'pershare') {
    var ps = keys.filter(function (u) { return /\/shares$/.test(u); });
    var hit = ps.filter(function (u) { return ccy && u.indexOf(ccy) === 0; })[0];
    return hit || ps[0] || null;
  }
  if (ccy && units[ccy]) return ccy;
  var money = keys.filter(function (u) { return /^[A-Z]{3}$/.test(u); });
  money.sort(function (a, b) { return units[b].length - units[a].length; });
  return money[0] || null;
}

var ANNUAL_FORM = /^(10-K|10-KT|20-F|40-F)/;
// Only financial reports count (proxy statements and 8-Ks also carry tagged figures).
var REPORT_FORM = /^(10-K|10-Q|10-KT|10-QT|20-F|40-F|6-K)/;

/**
 * Duration facts for ONE tag, one value per period. When several filings report
 * the same period, the latest filing wins, except that values ~1000x smaller
 * than another filing's (a known filer scaling slip) are discarded first.
 */
function tagSeries_(ns, tag, kind, ccy, rank) {
  var t = ns[tag]; if (!t) return [];
  var u = pickUnit_(t.units, kind, ccy); if (!u) return [];
  var groups = {};
  t.units[u].forEach(function (f) {
    if (!f.start || f.val === null || f.val === undefined || !REPORT_FORM.test(f.form || '')) return;
    (groups[f.start + '|' + f.end] = groups[f.start + '|' + f.end] || []).push(f);
  });
  return Object.keys(groups).map(function (key) {
    var g = groups[key];
    var maxAbs = Math.max.apply(null, g.map(function (f) { return Math.abs(f.val); }));
    var keep = g.filter(function (f) { return Math.abs(f.val) * 300 >= maxAbs; });
    keep.sort(function (x, y) { return x.filed < y.filed ? 1 : -1; });
    var f = keep[0];
    return { start: f.start, end: f.end, val: f.val, filed: f.filed, form: f.form, tag: tag, rank: rank || 0,
      fy: g.some(function (x) { return ANNUAL_FORM.test(x.form || ''); }), dur: dnum_(f.end) - dnum_(f.start) };
  });
}

/** Per-tag series plus a merged series (highest-priority tag per period), sharing the same objects. */
function fieldSeries_(ns, tags, kind, ccy) {
  var byTag = (tags || []).map(function (tag, rank) { return tagSeries_(ns, tag, kind, ccy, rank); })
    .filter(function (s) { return s.length; });
  var out = {};
  byTag.forEach(function (s) {
    s.forEach(function (f) { var k = f.start + '|' + f.end; if (!out[k] || f.rank < out[k].rank) out[k] = f; });
  });
  return { byTag: byTag, merged: Object.keys(out).map(function (k) { return out[k]; }) };
}

/** Kept for callers that only need the merged series. */
function durationSeries_(ns, tags, kind, ccy) { return fieldSeries_(ns, tags, kind, ccy).merged; }

function keyMap_(s) { var m = {}; s.forEach(function (f) { m[f.start + '|' + f.end] = f; }); return m; }

/**
 * Repairs factor-of-1000 scaling slips using net income = EPS x diluted shares.
 * Revenue decides which side is wrong: net income far below 1/300 of revenue is
 * taken as the slip; otherwise the share count is.
 */
function fixScaleSlips_(F) {
  var eps = keyMap_(F.EPS.merged), sh = keyMap_(F.DilutedShares.merged), rev = keyMap_(F.Revenue.merged);
  var fixed = {}, notes = [];
  F.NetIncome.byTag.forEach(function (s) {
    s.forEach(function (f) {
      var k = f.start + '|' + f.end, e = eps[k], n = sh[k];
      if (!e || !n || !e.val || !n.val || !f.val) return;
      var r = f.val / (e.val * n.val);
      if (r <= 0) return;
      var lr = Math.log(r) / Math.LN10 / 3, step = Math.round(lr);
      if (step === 0 || Math.abs(lr - step) > 0.25) return;
      var rv = rev[k];
      if (!rv || !rv.val) return;
      var niPlausible = Math.abs(f.val) * 300 >= Math.abs(rv.val) && Math.abs(f.val) <= 300 * Math.abs(rv.val);
      if (!niPlausible) { f.val = f.val / Math.pow(1000, step); notes.push('net income ' + f.end); }
      else if (!fixed[k]) { n.val = n.val * Math.pow(1000, step); fixed[k] = 1; notes.push('share count ' + f.end); }
    });
  });
  return notes;
}

/**
 * TTM for one field from a single tag (mixing tags inside one TTM sum gives wrong
 * answers). mode 'max' (revenue) takes the largest tag; otherwise the first tag
 * that can produce a value. Falls back to the merged series.
 */
function ttmField_(F, end, endPrev, mode) {
  var vals = F.byTag.map(function (s) { return { v: ttmAt_(s, end), v1: ttmAt_(s, endPrev) }; });
  var have = vals.filter(function (x) { return x.v !== null; });
  var have1 = vals.filter(function (x) { return x.v1 !== null; });
  var v = null, v1 = null;
  if (mode === 'max') {
    if (have.length) v = Math.max.apply(null, have.map(function (x) { return x.v; }));
    if (have1.length) v1 = Math.max.apply(null, have1.map(function (x) { return x.v1; }));
  } else {
    if (have.length) { v = have[0].v; v1 = have[0].v1; }
    if (v1 === null && have1.length) v1 = have1[0].v1;
  }
  if (v === null) v = ttmAt_(F.merged, end);
  if (v1 === null) v1 = ttmAt_(F.merged, endPrev);
  return { v: v, v1: v1 };
}

/** Fiscal-year value (annual reports only), for the year ending near endDay. */
function fyValue_(F, endDay, mode) {
  var pick = function (s) {
    var c = s.filter(function (f) { return isAnnual_(f) && f.fy && Math.abs(dnum_(f.end) - endDay) <= 12; });
    c.sort(function (a, b) { return Math.abs(a.dur - 365) - Math.abs(b.dur - 365); });
    return c.length ? c[0].val : null;
  };
  if (mode === 'max') {
    var all = F.byTag.map(pick).filter(function (v) { return v !== null; });
    return all.length ? Math.max.apply(null, all) : null;
  }
  return pick(F.merged);
}

/** Point-in-time facts (balance sheet), merged across tags in priority order. */
function instantSeries_(ns, tags, kind, ccy) {
  var out = {};
  (tags || []).forEach(function (tag, rank) {
    var t = ns[tag]; if (!t) return;
    var u = pickUnit_(t.units, kind, ccy); if (!u) return;
    t.units[u].forEach(function (f) {
      if (f.start || f.val === null || f.val === undefined || !REPORT_FORM.test(f.form || '')) return;
      var cur = out[f.end];
      if (!cur || rank < cur.rank || (rank === cur.rank && f.filed > cur.filed)) {
        out[f.end] = { end: f.end, val: f.val, filed: f.filed, rank: rank };
      }
    });
  });
  return Object.keys(out).map(function (k) { return out[k]; })
    .sort(function (a, b) { return a.end < b.end ? 1 : -1; });
}

/** Annual value for the fiscal year ending near `endDay`. */
function annualAt_(s, endDay) {
  var c = s.filter(function (f) { return isAnnual_(f) && Math.abs(dnum_(f.end) - endDay) <= 12; });
  c.sort(function (a, b) { return Math.abs(a.dur - 365) - Math.abs(b.dur - 365); });
  return c.length ? c[0].val : null;
}

/**
 * Trailing-12-month value for the period ending near `endDay`:
 *   a full fiscal year if one ends there, otherwise
 *   last full year + this year-to-date − last year's same year-to-date.
 */
function ttmAt_(s, endDay) {
  var a = annualAt_(s, endDay);
  if (a !== null) return a;
  var ytd = s.filter(function (f) { return f.dur >= 80 && f.dur <= 300 && Math.abs(dnum_(f.end) - endDay) <= 12; })
    .sort(function (x, y) { return y.dur - x.dur; })[0];
  if (!ytd) return null;
  var full = annualAt_(s, dnum_(ytd.start) - 1);
  var prior = s.filter(function (f) {
    return f !== ytd && Math.abs(f.dur - ytd.dur) <= 12 && Math.abs(dnum_(f.end) - (dnum_(ytd.end) - 365)) <= 12;
  })[0];
  if (full === null || !prior) return null;
  return full + ytd.val - prior.val;
}

/** Latest diluted share count: the most recent quarter (or year) reported. */
function latestDuration_(s, endDay, tol) {
  var c = s.filter(function (f) { return f.dur >= 80 && Math.abs(dnum_(f.end) - endDay) <= (tol || 12); })
    .sort(function (a, b) { return a.dur - b.dur; });
  return c.length ? c[0].val : null;
}

function instantNear_(s, endDay, tol) {
  var c = s.filter(function (f) { return Math.abs(dnum_(f.end) - endDay) <= tol; });
  c.sort(function (a, b) { return Math.abs(dnum_(a.end) - endDay) - Math.abs(dnum_(b.end) - endDay); });
  return c.length ? c[0].val : null;
}

/**
 * Total debt at the balance-sheet date: the first tag group with a value there.
 * If none is tagged on that date, the most recent value within 200 days is used
 * (companies sometimes switch tags between reports).
 */
function debtAt_(ns, map, ccy, endDay) {
  var groups = map.DebtGroups || [];
  var extrasAt = function (day, tol) {
    return (map.DebtExtras || []).reduce(function (s, tag) {
      return s + (instantNear_(instantSeries_(ns, [tag], 'money', ccy), day, tol) || 0);
    }, 0);
  };
  for (var g = 0; g < groups.length; g++) {
    var first = instantSeries_(ns, [groups[g][0]], 'money', ccy);
    if (instantNear_(first, endDay, 5) === null) continue;
    var total = groups[g].reduce(function (s, tag) {
      return s + (instantNear_(instantSeries_(ns, [tag], 'money', ccy), endDay, 5) || 0);
    }, 0);
    return { val: total + extrasAt(endDay, 5), found: true, day: endDay };
  }
  // Nothing tagged on the balance-sheet date: take the latest group value in the prior 200 days.
  var best = null;
  groups.forEach(function (grp) {
    var s = instantSeries_(ns, [grp[0]], 'money', ccy).filter(function (f) {
      var d = dnum_(f.end); return d <= endDay && d >= endDay - 200;
    });
    if (!s.length) return;
    var day = dnum_(s[0].end);
    if (best && day <= best.day) return;
    var total = grp.reduce(function (sum, tag) {
      return sum + (instantNear_(instantSeries_(ns, [tag], 'money', ccy), day, 5) || 0);
    }, 0);
    best = { val: total + extrasAt(day, 5), found: true, day: day, earlier: true };
  });
  if (best) return best;
  var ex = extrasAt(endDay, 5);
  return { val: ex, found: ex > 0, day: endDay };
}

function latestEndDay_(series) {
  var best = null;
  series.forEach(function (f) { if (f.dur >= 80 && (best === null || dnum_(f.end) > best)) best = dnum_(f.end); });
  return best;
}

function isoDay_(d) { return d === null ? '' : new Date(d * DAY).toISOString().slice(0, 10); }

/** Builds the Raw Data row for one company. */
function parseCompany(ticker, cik, facts, sub) {
  var notes = [];
  var row = { Ticker: ticker, CIK: cik, 'SEC name': facts.entityName || (sub && sub.name) || '' };
  if (sub) {
    row.SIC = sub.sic || '';
    row.Industry = sub.sicDescription || '';
    var forms = (sub.filings && sub.filings.recent && sub.filings.recent.form) || [];
    var dates = (sub.filings && sub.filings.recent && sub.filings.recent.filingDate) || [];
    for (var i = 0; i < forms.length; i++) {
      if (/^(10-K|20-F|40-F)/.test(forms[i])) { row['Filer form'] = forms[i].replace('/A', ''); break; }
    }
    row['Last filed'] = dates[0] || '';
  }

  // Choose the accounting standard with the most recent net income.
  var std = null, stdEnd = -1;
  ['us-gaap', 'ifrs-full'].forEach(function (k) {
    var ns = facts.facts && facts.facts[k];
    if (!ns) return;
    var e = latestEndDay_(durationSeries_(ns, TAGS[k].NetIncome, 'money', null));
    if (e !== null && e > stdEnd) { std = k; stdEnd = e; }
  });
  if (!std) { row.Status = 'No income statement data in SEC filings'; return row; }
  var ns = facts.facts[std], map = TAGS[std];
  row.Accounting = std === 'us-gaap' ? 'US GAAP' : 'IFRS';

  // Reporting currency = the unit most net-income facts use.
  var niTag = map.NetIncome.filter(function (t) { return ns[t]; })[0];
  var ccy = pickUnit_(ns[niTag].units, 'money', null);
  row.Currency = ccy;

  var F = {};
  FLOW_FIELDS.forEach(function (f) { F[f] = fieldSeries_(ns, map[f], 'money', ccy); });
  F.EPS = fieldSeries_(ns, map.EPS, 'pershare', ccy);
  F.DilutedShares = fieldSeries_(ns, map.DilutedShares, 'shares', ccy);
  var slips = fixScaleSlips_(F);
  if (slips.length) notes.push('Corrected filer scaling slip in ' + slips.slice(0, 4).join(', ') + (slips.length > 4 ? ' and ' + (slips.length - 4) + ' more' : ''));

  // Gross profit: fill missing periods with revenue − cost of revenue.
  var cost = keyMap_(durationSeries_(ns, map.CostOfRevenue, 'money', ccy));
  var gpKeys = keyMap_(F.GrossProfit.merged), derived = [];
  F.Revenue.merged.forEach(function (r) {
    var k = r.start + '|' + r.end;
    if (gpKeys[k] || !cost[k]) return;
    derived.push({ start: r.start, end: r.end, val: r.val - cost[k].val, dur: r.dur, fy: r.fy, rank: 99 });
  });
  if (derived.length) {
    F.GrossProfit.merged = F.GrossProfit.merged.concat(derived);
    F.GrossProfit.byTag.push(derived);
  }
  var S = {};
  Object.keys(F).forEach(function (k) { S[k] = F[k].merged; });

  // Period anchors.
  var end = latestEndDay_(S.NetIncome);
  var endPrev = end - 365;
  row['Latest period end'] = isoDay_(end);

  var stale = [];
  FLOW_FIELDS.forEach(function (f) {
    var mode = f === 'Revenue' ? 'max' : '';
    var t = ttmField_(F[f], end, endPrev, mode), v = t.v, v1 = t.v1;
    if (v === null && S[f].length) {
      var ownEnd = latestEndDay_(S[f]);
      if (ownEnd !== null && ownEnd < end) {
        var o = ttmField_(F[f], ownEnd, ownEnd - 365, mode);
        if (o.v !== null) { stale.push(f); v = o.v; v1 = o.v1; }
      }
    }
    row[f + ' TTM'] = v === null ? '' : v;
    row[f + ' TTM 1y ago'] = v1 === null ? '' : v1;
  });
  var keyStale = stale.filter(function (f) { return ['Revenue', 'GrossProfit', 'OperatingIncome', 'NetIncome', 'OCF', 'Capex'].indexOf(f) >= 0; });
  if (keyStale.length) notes.push('Older period used for: ' + keyStale.join(', '));

  var et = ttmField_(F.EPS, end, endPrev, ''), eps = et.v, eps1 = et.v1;
  row['EPS TTM'] = eps === null ? '' : eps;
  row['EPS TTM 1y ago'] = eps1 === null ? '' : eps1;
  var sh = latestDuration_(S.DilutedShares, end), sh1 = latestDuration_(S.DilutedShares, endPrev);
  row['Diluted shares latest'] = sh === null ? '' : sh;
  row['Diluted shares 1y ago'] = sh1 === null ? '' : sh1;

  // Balance sheet at the latest date that has equity or cash.
  var eqS = instantSeries_(ns, map.Equity, 'money', ccy);
  var cashS = instantSeries_(ns, map.Cash, 'money', ccy);
  var bsEnd = Math.max(eqS.length ? dnum_(eqS[0].end) : -1, cashS.length ? dnum_(cashS[0].end) : -1);
  if (bsEnd > 0) {
    row['Balance sheet date'] = isoDay_(bsEnd);
    var cash = instantNear_(cashS, bsEnd, 5);
    row.Cash = cash === null ? '' : cash;
    var sti = instantNear_(instantSeries_(ns, map.ShortTermInvestments, 'money', ccy), bsEnd, 5);
    row['Short-term investments'] = sti === null ? 0 : sti;
    var eq = instantNear_(eqS, bsEnd, 5), eq1 = instantNear_(eqS, bsEnd - 365, 15);
    row.Equity = eq === null ? '' : eq;
    row['Equity 1y ago'] = eq1 === null ? '' : eq1;
    var debt = debtAt_(ns, map, ccy, bsEnd);
    row['Total debt'] = debt.val;
    if (!debt.found) notes.push('No debt tagged in filings (taken as 0)');
    else if (debt.earlier) notes.push('Debt taken from ' + isoDay_(debt.day) + ' (not tagged on the latest balance sheet)');
  }
  var dei = facts.facts.dei && facts.facts.dei.EntityCommonStockSharesOutstanding;
  var so = dei ? instantSeries_(facts.facts.dei, ['EntityCommonStockSharesOutstanding'], 'shares', ccy) : [];
  if (!so.length) so = instantSeries_(ns, map.SharesOutstanding, 'shares', ccy);
  row['Shares outstanding'] = so.length ? so[0].val : '';
  if (row['Diluted shares latest'] === '' && so.length) {
    row['Diluted shares latest'] = so[0].val;
    notes.push('No diluted share count filed; cover-page shares outstanding used');
  }

  // Annual history (annual reports only), newest first, aligned on fiscal-year end dates.
  var fyEnds = [];
  S.NetIncome.concat(S.Revenue).forEach(function (f) {
    if (!isAnnual_(f) || !f.fy) return;
    var d = dnum_(f.end);
    if (fyEnds.every(function (x) { return Math.abs(x - d) > 30; })) fyEnds.push(d);
  });
  fyEnds.sort(function (a, b) { return b - a; });
  row['Latest FY end'] = fyEnds.length ? isoDay_(fyEnds[0]) : '';
  HISTORY_FIELDS.forEach(function (f) {
    for (var i = 0; i <= 5; i++) {
      var v = fyEnds[i] === undefined ? null : fyValue_(F[f], fyEnds[i], f === 'Revenue' ? 'max' : '');
      row[f + ' FY' + (i === 0 ? '0' : '-' + i)] = v === null ? '' : v;
    }
  });

  var need = ['Revenue TTM', 'NetIncome TTM', 'OCF TTM', 'Diluted shares latest', 'Cash', 'Equity'];
  var missing = need.filter(function (k) { return row[k] === '' || row[k] === undefined; });
  row.Status = missing.length ? 'Partial: missing ' + missing.join(', ') : 'OK';
  if (end < dnum_(new Date().toISOString().slice(0, 10)) - 200) notes.push('Latest financials are over 200 days old');
  row.Notes = notes.join('; ');
  return row;
}

/* ------------------------------------------------------------------------ */
/*  Settings, log                                                            */
/* ------------------------------------------------------------------------ */

function getNamed_(name) {
  var r = SpreadsheetApp.getActive().getRangeByName(name);
  return r ? r.getValue() : '';
}

function log_(ticker, msg) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET.LOG);
  if (!sh) return;
  sh.insertRowAfter(1);
  sh.getRange(2, 1, 1, 3).setValues([[new Date(), ticker, msg]]);
  if (sh.getLastRow() > 501) sh.deleteRows(502, sh.getLastRow() - 501);
}

/* Lets the parsing functions be tested outside Google (ignored by Apps Script). */
if (typeof module !== 'undefined') {
  module.exports = { TAGS: TAGS, parseCompany: parseCompany, parseCsv: parseCsv, buildRawRows: buildRawRows, RAW_COLS: RAW_COLS };
}
