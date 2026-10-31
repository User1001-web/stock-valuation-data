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
      'AvailableForSaleSecuritiesDebtSecuritiesCurrent', 'MarketableSecurities',
      'AvailableForSaleSecuritiesDebtSecurities'],
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
      ['ConvertibleLongTermNotesPayable', 'ConvertibleNotesPayableCurrent'],
      ['SeniorNotes'],
      ['UnsecuredDebt'],
      ['SecuredDebt'],
      ['DebtInstrumentCarryingAmount'],
      ['OtherLongTermDebtNoncurrent', 'OtherLongTermDebtCurrent'],
      ['LongTermLineOfCredit'],
      ['LineOfCredit'],
      ['DebtCurrent']
    ],
    DebtExtras: ['ShortTermBorrowings', 'CommercialPaper']
  },
  'ifrs-full': {
    Revenue: ['Revenue', 'RevenueFromContractsWithCustomers', 'RevenueFromSaleOfGoods'],
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
  c.push('Est FY1 end', 'Est revenue FY1', 'Est revenue FY2', 'Est EPS FY1', 'Est EPS FY2', 'Est analysts',
    'Target consensus', 'Target high', 'Target low', 'Est FY2 end', 'Est source', 'Sector', 'Yahoo price', 'Yahoo industry',
    'Next earnings', 'Last EPS surprise', 'Last earnings quarter', 'EPS est now', 'EPS est 30d ago', 'EPS est 90d ago',
    'Revisions up 30d', 'Revisions down 30d');
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
    .addItem('Recalculate valuations', 'recalcValuations')
    .addItem('Rebuild Market tab', 'rebuildMarket')
    .addItem('Repair formulas (after sorting)', 'repairFormulas')
    .addToUi();
}

/** Simple trigger: keeps the Market tab in step when you edit ticker lists. */
function onEdit(e) {
  try {
    var name = e.range.getSheet().getName();
    if ((name === SHEET.TICKERS || name === SHEET.HOLDINGS) && e.range.getColumn() <= 2) { syncMarket_(); recalcValuations(); }
    if (name === SHEET.ASSUME || (name === SHEET.TICKERS && e.range.getColumn() >= 5 && e.range.getColumn() <= 7)) recalcValuations();
  } catch (err) { /* never block an edit */ }
}

function repairFormulas() { repairFormulas_(); recalcValuations(); SpreadsheetApp.getActive().toast('Formulas repaired.', 'Valuation', 5); }

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
  SpreadsheetApp.flush();            // let GOOGLEFINANCE start loading prices
  ensureSettings_();
  recalcValuations();
  writeHoldingsValuation_();
  writeWatchlist_();
  writeColourRules_();

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

/** Rewrites the formula-only columns on Tickers (D) and Holdings (F onwards). Safe after sorting. */
function repairFormulas_() {
  var ss = SpreadsheetApp.getActive();
  var tk = ss.getSheetByName(SHEET.TICKERS), ho = ss.getSheetByName(SHEET.HOLDINGS);
  tk.getRange(2, 4, Math.max(tk.getMaxRows() - 1, 1), 1).clearContent();
  writeTickerFormulas_();
  ho.getRange(2, 6, Math.max(ho.getMaxRows() - 1, 1), Math.max(ho.getMaxColumns() - 5, 1)).clearContent();
  writeHoldingsFormulas_();
  if (ss.getSheetByName(SHEET2.CALC)) { writeHoldingsValuation_(true); writeWatchlist_(true); }
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
    '=IF(IFERROR(VLOOKUP($A' + r + ',Tickers!$A:$B,2,FALSE),"")<>"",VLOOKUP($A' + r + ',Tickers!$A:$B,2,FALSE),' +
      'IFERROR(SWITCH(UPPER(VLOOKUP($A' + r + ',Tickers!$A:$C,3,FALSE)),"UK","LON:","ETF","LON:","DE","ETR:","FR","EPA:","NL","AMS:",' +
      '"CH","SWX:","IT","BIT:","ES","BME:","SE","STO:","DK","CPH:","NO","OSL:","FI","HEL:","BE","EBR:","IE","ISE:",""),"")&$A' + r + ')',
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
    repairFormulas_();
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
    sh.getRange(1, 1, 1, RAW_COLS.length).setValues([RAW_COLS]).setFontWeight('bold');
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
    if (result.rows.length) sh.getRange(2, 1, result.rows.length, RAW_COLS.length).setValues(result.rows);
    loadRates_(url);
    recalcValuations();

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
 * If none is tagged on that date, the most recent value within 400 days is used
 * (some companies only tag debt in annual reports, or switch tags).
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
  // Nothing tagged on the balance-sheet date: take the latest group value in the prior 400 days.
  var best = null;
  groups.forEach(function (grp) {
    var s = instantSeries_(ns, [grp[0]], 'money', ccy).filter(function (f) {
      var d = dnum_(f.end); return d <= endDay && d >= endDay - 400;
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

/* ======================================================================== */
/*  STAGE 2 — VALUATION ENGINE (pure functions, no Sheets calls)            */
/* ======================================================================== */

/** Assumptions-tab rows: [label, default, number format, note]. Read by label. */
var SETTINGS = [
  ['Risk-free rate (10-yr Treasury)', 0.05, '0.00%', 'Updated automatically from FRED each day. To fix it yourself, use the override row below.'],
  ['Risk-free rate override', '', '0.00%', 'Optional. Leave blank to use the automatic rate.'],
  ['AAA corporate bond yield', 0.06, '0.00%', 'Updated automatically from FRED. Used by the Graham formula.'],
  ['AAA yield override', '', '0.00%', 'Optional.'],
  ['Equity risk premium', 0.045, '0.0%', 'Extra return investors demand from shares over Treasuries. Discount rate = risk-free + beta x this.'],
  ['Beta floor', 0.8, '0.00', 'Betas below this are raised to it.'],
  ['Beta cap', 2.0, '0.00', 'Betas above this are lowered to it.'],
  ['Beta if missing', 1.2, '0.00', ''],
  ['Discount rate floor', 0.07, '0.0%', ''],
  ['Discount rate cap', 0.14, '0.0%', ''],
  ['Required return (5-year models)', 0.10, '0.0%', 'Annual return used to discount the 5-year projection models back to today.'],
  ['Starting growth cap', 0.35, '0.0%', 'Year-1 growth is capped here, then fades to terminal growth by year 10.'],
  ['Growth floor', -0.10, '0.0%', ''],
  ['Terminal growth', 0.03, '0.0%', 'Long-run growth after year 10 (roughly nominal GDP).'],
  ['Exit P/E cap', 25, '0.0', 'Exit multiples = 8.5 + 2 x later growth (%), capped here.'],
  ['Exit P/FCF cap', 30, '0.0', ''],
  ['Margin of safety', 0.25, '0%', 'Buy-below price = fair value x (1 - this).'],
  ['Subtract stock-based comp from FCF', 'No', '@', 'Yes or No.'],
  ['Growth stock threshold (3-yr revenue CAGR)', 0.15, '0%', 'Profitable companies whose average of 1-yr and 3-yr revenue growth exceeds this are classed as Growth.'],
  ['Default long-run FCF margin (pre-profit)', 0.15, '0%', 'Used when a company has no positive margin history. Per-stock override on Tickers.'],
  ['Default long-run net margin (pre-profit)', 0.12, '0%', ''],
  ['Stretched if 5-yr expected return below', 0.06, '0%', ''],
  ['Max data age (months)', 15, '0', 'Older SEC data is not valued.']
];

function settingsFromMap_(m) {
  var g = function (label) {
    var row = SETTINGS.filter(function (r) { return r[0] === label; })[0];
    var v = m[label];
    if (v === '' || v === undefined || v === null) return row ? row[1] : null;
    return v;
  };
  var num = function (label) { var v = g(label); return v === '' ? null : Number(v); };
  var rfo = m['Risk-free rate override'], aao = m['AAA yield override'];
  return {
    rf: rfo !== '' && rfo !== undefined && rfo !== null ? Number(rfo) : num('Risk-free rate (10-yr Treasury)'),
    aaa: aao !== '' && aao !== undefined && aao !== null ? Number(aao) : num('AAA corporate bond yield'),
    erp: num('Equity risk premium'), betaMin: num('Beta floor'), betaMax: num('Beta cap'),
    betaDefault: num('Beta if missing'), rMin: num('Discount rate floor'), rMax: num('Discount rate cap'),
    req: num('Required return (5-year models)'), gCap: num('Starting growth cap'), gFloor: num('Growth floor'),
    gTerm: num('Terminal growth'), peCap: num('Exit P/E cap'), pfcfCap: num('Exit P/FCF cap'),
    mos: num('Margin of safety'), sbc: /^y/i.test(String(g('Subtract stock-based comp from FCF'))),
    growthThreshold: num('Growth stock threshold (3-yr revenue CAGR)'),
    defFcfMargin: num('Default long-run FCF margin (pre-profit)'),
    defNetMargin: num('Default long-run net margin (pre-profit)'),
    stretchReturn: num('Stretched if 5-yr expected return below'),
    maxAgeMonths: num('Max data age (months)')
  };
}

function n_(v) {
  if (v === '' || v === null || v === undefined) return null;
  var x = Number(v);
  return isFinite(x) ? x : null;
}
function clamp_(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function mean_(a) { a = a.filter(function (x) { return x !== null && isFinite(x); }); return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : null; }
function median_(a) { a = a.slice().sort(function (x, y) { return x - y; }); var k = a.length; return k ? (k % 2 ? a[(k - 1) / 2] : (a[k / 2 - 1] + a[k / 2]) / 2) : null; }

/** Growth path: year-1 rate g0 fading in a straight line to terminal growth in year 10. */
function growthPath_(g0, gT) {
  var p = [];
  for (var t = 1; t <= 10; t++) p.push(g0 + (gT - g0) * (t - 1) / 9);
  return p;
}
function grow_(base, path, years) { var v = base; for (var t = 0; t < years; t++) v *= 1 + path[t]; return v; }
function exitMultiple_(laterGrowth, cap) { return clamp_(8.5 + 2 * laterGrowth * 100, 8, cap); }

/** Two-stage DCF per share: 10 years on the growth path, then a terminal value. */
function dcfPerShare_(fcf0, g0, gT, r, netCash, shares) {
  var path = growthPath_(g0, gT), cf = fcf0, pv = 0;
  for (var t = 1; t <= 10; t++) { cf *= 1 + path[t - 1]; pv += cf / Math.pow(1 + r, t); }
  var tv = cf * (1 + gT) / (r - gT) / Math.pow(1 + r, 10);
  return (pv + tv + netCash) / shares;
}

/** Revenue-based 5-year projection: revenue x margin x exit multiple, per future share, discounted. */
function projection5_(rev0, g0, gT, margin, mult, shares, dil, req, years) {
  var path = growthPath_(g0, gT);
  var rev5 = grow_(rev0, path, years === undefined ? 5 : years);
  var sh5 = shares * Math.pow(1 + dil, 5);
  var target = rev5 * margin * mult / sh5;
  return { fv: target / Math.pow(1 + req, 5), target: target };
}

/** Solves for the year-1 growth rate that makes f(g) equal the price (f rises with g). */
function solveGrowth_(f, price) {
  var lo = -0.5, hi = 1.5;
  if (f(hi) < price) return { g: null, note: 'above 150%' };
  if (f(lo) > price) return { g: null, note: 'below -50%' };
  for (var i = 0; i < 60; i++) { var mid = (lo + hi) / 2; if (f(mid) < price) lo = mid; else hi = mid; }
  return { g: (lo + hi) / 2, note: '' };
}

var MODEL_NAMES = ['DCF', 'FCF future market cap', '5-yr earnings', 'Fwd EPS x P/E', 'Graham', 'Lynch', 'Dividend discount', 'Justified P/B'];
var MODELS_BY_TYPE = {
  'Mature': ['DCF', 'FCF future market cap', '5-yr earnings', 'Fwd EPS x P/E', 'Graham', 'Dividend discount'],
  'Growth': ['DCF', 'FCF future market cap', '5-yr earnings', 'Fwd EPS x P/E', 'Graham', 'Lynch', 'Dividend discount'],
  'Pre-profit': ['FCF future market cap', '5-yr earnings'],
  'Financial': ['Justified P/B', 'Fwd EPS x P/E', 'Dividend discount']
};

/**
 * Values one company.
 *  raw  : Raw Data row as {header: value}
 *  mkt  : {price, currency, beta, shares}
 *  fx   : multiply reported-currency amounts by this to get listing currency (null = unknown)
 *  ovr  : {type, growth, margin} per-stock overrides from Tickers (blank = none)
 *  S    : settings (settingsFromMap_)
 *  past : {fv, score} from ~3 months ago, or null
 *  today: day number (dnum_)
 */
function valueCompany(raw, mkt, fx, ovr, S, past, today) {
  var out = { models: {}, notes: [], signals: {} };
  out.analystTarget = n_(raw['Target consensus']);
  out.analysts = n_(raw['Est analysts']);
  out.nextEarnings = raw['Next earnings'] || '';
  var ne = String(out.nextEarnings).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(ne) && dnum_(ne) < today) out.nextEarnings = 'Reported ' + ne + ' (next date not set)';
  out.surprise = n_(raw['Last EPS surprise']);
  if (out.surprise !== null && Math.abs(out.surprise) > 5) out.surprise = out.surprise / 100;   // percent vs fraction
  var eNow = n_(raw['EPS est now']), e30 = n_(raw['EPS est 30d ago']), e90 = n_(raw['EPS est 90d ago']);
  var chg = function (a, b) { return a !== null && b !== null && b !== 0 ? (a - b) / Math.abs(b) : null; };
  out.estChg30 = chg(eNow, e30); out.estChg90 = chg(eNow, e90);
  var up30 = n_(raw['Revisions up 30d']), dn30 = n_(raw['Revisions down 30d']);
  out.revisionsText = up30 !== null || dn30 !== null ? (up30 || 0) + ' up / ' + (dn30 || 0) + ' down' : '';
  var status = String(raw.Status || '');
  out.dataDate = raw['Latest period end'] || '';
  if (!raw.CIK || /^(Skipped|No SEC|SEC has no|Error|Waiting)/.test(status)) {
    out.type = /^Waiting/.test(status) ? 'Waiting for data' : /ETF/.test(status) ? 'ETF' : /UK/.test(status) ? 'No UK data' : 'No SEC data';
    if (/^Waiting/.test(status)) out.notes.push('Financials arrive with the next GitHub run (daily 05:17 UTC, or Run workflow on GitHub)');
    return out;
  }
  if (out.dataDate && today - dnum_(out.dataDate) > S.maxAgeMonths * 30.4) {
    out.type = 'Data too old';
    out.notes.push('Latest SEC figures are for ' + out.dataDate);
    return out;
  }
  if (fx === null) { out.type = 'Waiting for FX'; out.notes.push('Exchange rate for ' + raw.Currency + ' not loaded yet'); return out; }

  var F = function (k) { var v = n_(raw[k]); return v === null ? null : v * fx; };
  var price = n_(mkt.price);
  if (price === null) price = n_(raw['Yahoo price']);
  var shares = n_(raw['Diluted shares latest']);
  var gShares = n_(mkt.shares);
  if (!shares && gShares) { shares = gShares; out.notes.push('Share count from Google Finance'); }
  else if (shares && gShares && (gShares / shares > 3 || shares / gShares > 3)) {
    shares = gShares; out.notes.push('SEC share count looked inconsistent; Google Finance count used');
  }
  if (!shares) { out.type = 'No share count'; return out; }
  var shares1 = n_(raw['Diluted shares 1y ago']);

  var rev = F('Revenue TTM'), rev1 = F('Revenue TTM 1y ago');
  var ni = F('NetIncome TTM'), ni1 = F('NetIncome TTM 1y ago');
  var ocf = F('OCF TTM'), capex = F('Capex TTM') || 0, sbc = F('SBC TTM') || 0;
  var ocf1 = F('OCF TTM 1y ago'), capex1 = F('Capex TTM 1y ago') || 0;
  var fcf = ocf === null ? null : ocf - capex - (S.sbc ? sbc : 0);
  var fcf1 = ocf1 === null ? null : ocf1 - capex1;
  var cash = (F('Cash') || 0) + (F('Short-term investments') || 0), debt = F('Total debt') || 0;
  var netCash = cash - debt;
  var equity = F('Equity');
  var div = Math.abs(F('DividendsPaid TTM') || 0);
  var eps = ni === null ? null : ni / shares;

  // Revenue growth
  var fy = function (field, i) { return F(field + ' FY' + (i === 0 ? '0' : '-' + i)); };
  var yoy = rev && rev1 && rev1 > 0 && rev > 0 ? rev / rev1 - 1 : null;
  var r0 = fy('Revenue', 0), r3 = fy('Revenue', 3);
  var cagr3 = r0 && r3 && r0 > 0 && r3 > 0 ? Math.pow(r0 / r3, 1 / 3) - 1 : null;
  out.revYoY = yoy; out.revCagr3 = cagr3;

  // Classification
  var sic = Number(raw.SIC) || 0;
  var type;
  var ovType = String(ovr.type || '').trim();
  if (ovType && MODELS_BY_TYPE[ovType]) { type = ovType; out.notes.push('Type set by override'); }
  else if (((sic >= 6000 && sic <= 6299) || sic === 6726) && !(rev && capex / rev > 0.1)) type = 'Financial';
  else if ((raw.CIK === 'LSE' && !raw.Sector) || ((raw.CIK === 'LSE' || raw.CIK === 'YAHOO') && (raw.Sector === 'Financial Services' || raw.Sector === 'Real Estate'))) type = 'Financial';
  else if (ni === null || ni <= 0) type = 'Pre-profit';
  else if ((mean_([yoy, cagr3]) || 0) >= S.growthThreshold) type = 'Growth';
  else type = 'Mature';
  out.type = type;

  // Starting growth, path and discount rate
  var g0, basis;
  var ovG = n_(ovr.growth);
  var estRev2 = F('Est revenue FY2'), estEps2 = n_(raw['Est EPS FY2']);
  var consensus = estRev2 !== null && estRev2 > 0 && r0 !== null && r0 > 0;
  var fy0End = raw['Latest FY end'], fy2End = raw['Est FY2 end'] || '';
  var estYears = fy0End && fy2End ? clamp_((dnum_(String(fy2End).slice(0, 10)) - dnum_(String(fy0End).slice(0, 10))) / 365.25, 1, 3.5) : 2;
  var yearsAhead = fy2End ? clamp_((dnum_(String(fy2End).slice(0, 10)) - today) / 365.25, 0.5, 3) : 2;
  if (ovG !== null) { g0 = ovG > 1.5 ? ovG / 100 : ovG; basis = 'Override'; }
  else if (consensus) {
    g0 = Math.pow(estRev2 / r0, 1 / estYears) - 1;
    basis = 'Analyst consensus revenue growth (' + (n_(raw['Est analysts']) || '?') + ' analysts, ' + (raw['Est source'] || 'estimates') + ')';
  } else {
    var avg = mean_([yoy, cagr3]);
    g0 = avg === null ? S.gTerm : avg;
    basis = yoy !== null && cagr3 !== null ? 'Avg of 1-yr and 3-yr revenue growth' : yoy !== null ? '1-yr revenue growth' : cagr3 !== null ? '3-yr revenue growth' : 'No history (terminal rate)';
  }
  var g0raw = g0;
  g0 = clamp_(g0, S.gFloor, S.gCap);
  if (g0 !== g0raw && basis !== 'Override') basis += g0raw > g0 ? ' (capped)' : ' (floored)';
  var gT = S.gTerm, path = growthPath_(g0, gT);
  var avgRange = function (a, b) { return mean_(path.slice(a - 1, b)); };
  out.g0 = g0; out.gBasis = basis;

  var beta = n_(mkt.beta);
  if (beta === null) { beta = S.betaDefault; out.notes.push('No beta; ' + beta + ' assumed'); }
  var r = clamp_(S.rf + clamp_(beta, S.betaMin, S.betaMax) * S.erp, S.rMin, S.rMax);
  if (r - gT < 0.02) r = gT + 0.02;
  out.r = r;

  // Margins
  var margins = function (num) {
    var a = [];
    for (var i = 0; i <= 2; i++) { var x = num(i), rv = fy('Revenue', i); if (x !== null && rv) a.push(x / rv); }
    return mean_(a);
  };
  var fcfMarginNow = fcf !== null && rev ? fcf / rev : null;
  var fcfMarginAvg = margins(function (i) { var o = fy('OCF', i), c = fy('Capex', i) || 0; return o === null ? null : o - c; });
  var netMarginNow = ni !== null && rev ? ni / rev : null;
  var netMarginAvg = margins(function (i) { return fy('NetIncome', i); });
  var ovM = n_(ovr.margin);
  if (ovM !== null && ovM > 1.5) ovM = ovM / 100;
  // Long-run margins: average of the latest 12 months and the last 3 fiscal years
  // (averaging tempers peak-cycle margins).
  var mF = ovM !== null ? ovM : mean_([fcfMarginNow, fcfMarginAvg]);
  if (ovM === null && (mF === null || mF <= 0) && netMarginNow > 0) mF = mean_([netMarginNow, netMarginAvg > 0 ? netMarginAvg : null]);
  if (mF === null || mF <= 0) { mF = S.defFcfMargin; if (ovM === null && type !== 'Financial') out.notes.push('Default FCF margin used'); }
  var mN = ovM !== null ? ovM : mean_([netMarginNow, netMarginAvg]);
  if (mN === null || mN <= 0) { mN = S.defNetMargin; if (ovM === null && type !== 'Financial') out.notes.push('Default net margin used'); }
  mF = Math.min(mF, 0.6); mN = Math.min(mN, 0.6);

  // Possible cyclical peak: an established company (revenue >= 5bn three years ago) in a cyclical industry, revenue up >50% in a year AND net margin
  // more than double last year's. Valuing peak profits with growth on top overstates value,
  // so margins revert to the cycle average (this year + 3 prior) and growth starts at terminal.
  var prevNet = [];
  for (var pi = 1; pi <= 3; pi++) { var pn = fy('NetIncome', pi), pr = fy('Revenue', pi); if (pn !== null && pr) prevNet.push(pn / pr); }
  var lastYear = prevNet.length ? prevNet[0] : null;
  var cyclicalSic = (sic >= 1000 && sic <= 1499) || (sic >= 2800 && sic <= 2999) || (sic >= 3300 && sic <= 3399) ||
    (sic >= 3670 && sic <= 3679) || (sic >= 3711 && sic <= 3716) || (sic >= 4400 && sic <= 4499);
  var established = (fy('Revenue', 3) || 0) >= 5e9;
  var peak = cyclicalSic && established && ovG === null && ovM === null && yoy !== null && yoy > 0.5 && netMarginNow !== null &&
    lastYear !== null && netMarginNow > 0 && netMarginNow > 2 * Math.max(lastYear, 0.02);
  out.cyclicalPeak = peak;
  var fcfBase = fcf, epsBase = eps;
  if (peak) {
    var cycNet = mean_([netMarginNow].concat(prevNet)), cycFcf = mean_([fcfMarginNow, fcfMarginAvg]);
    mN = Math.max(cycNet, 0.01); mF = Math.max(cycFcf || cycNet, 0.01);
    fcfBase = rev * mF; epsBase = rev * mN / shares;
    if (!consensus) { g0 = gT; path = growthPath_(g0, gT); out.g0 = g0; out.gBasis = 'Cyclical peak: no growth assumed'; }
    out.notes.push('Possible cyclical peak: average-cycle margins used' + (consensus ? '' : ' and no growth') + ' (override on Tickers to change)');
  }

  // Dilution (ignores share-count jumps that look like splits)
  var dil = null;
  if (shares1) { var ratio = shares / shares1; if (ratio > 0.6 && ratio < 1.6) dil = ratio - 1; }
  out.dilution = dil;
  var dilP = dil === null ? 0 : clamp_(dil, -0.05, 0.15);

  var allowed = MODELS_BY_TYPE[type];
  var M = {};
  var hasRev = rev !== null && rev >= 25e6;
  // Pre-revenue: start the revenue projection from analysts' forecast instead (speculative).
  var projRev = rev, projYears = 5;
  if (!hasRev && consensus && estRev2 >= 25e6) {
    projRev = estRev2; projYears = Math.max(1, Math.round(5 - yearsAhead)); hasRev = true;
    out.notes.push('Pre-revenue: valued from analysts\' revenue forecast');
  }
  var peLater = exitMultiple_(avgRange(6, 10), S.peCap);
  var pfLater = exitMultiple_(avgRange(6, 10), S.pfcfCap);

  if (fcfBase !== null && fcfBase > 0 && type !== 'Financial') M['DCF'] = dcfPerShare_(fcfBase, g0, gT, r, netCash, shares);
  if (hasRev && type !== 'Financial') {
    M['FCF future market cap'] = projection5_(projRev, g0, gT, mF, pfLater, shares, dilP, S.req, projYears).fv;
    var p5 = projection5_(projRev, g0, gT, mN, peLater, shares, dilP, S.req, projYears);
    M['5-yr earnings'] = p5.fv;
    out.target5 = p5.target;
  }
  var useEstEps = consensus && !peak && estEps2 !== null && estEps2 > 0;
  if (useEstEps || (epsBase !== null && epsBase > 0)) {
    var eps2 = useEstEps ? estEps2 * fx : epsBase * (1 + path[0]) * (1 + path[1]);
    if (useEstEps) out.notes.push('Fwd EPS x P/E uses consensus EPS (analysts often use adjusted EPS)');
    var epsYears = useEstEps ? yearsAhead : 2;
    // Financials: modest multiple (banks/insurers rarely sustain growth multiples); growth from revenue is unreliable for them.
    var fwdPE = type === 'Financial' ? clamp_(8.5 + 2 * Math.min(avgRange(3, 7), gT) * 100, 8, Math.min(S.peCap, 14.5)) : exitMultiple_(avgRange(3, 7), S.peCap);
    M['Fwd EPS x P/E'] = eps2 * fwdPE / Math.pow(1 + S.req, epsYears);
  }
  if (epsBase !== null && epsBase > 0) {
    var gG = Math.min(avgRange(1, 10) * 100, 15);
    if (S.aaa > 0) M['Graham'] = epsBase * (8.5 + 2 * gG) * 4.4 / (S.aaa * 100);
    var gL = Math.min(avgRange(1, 5) * 100, 25);
    if (gL >= 5) M['Lynch'] = epsBase * gL;
  }
  if (price && div > 0 && div / (price * shares) >= 0.015) {
    // Dividend growth (perpetual, so no higher than terminal growth): 3-year growth in dividend per share where available.
    var d0 = fy('DividendsPaid', 0), d3 = fy('DividendsPaid', 3), s0 = n_(raw['DilutedShares FY0']), s3 = n_(raw['DilutedShares FY-3']);
    var dpsCagr = d0 && d3 && s0 && s3 && d3 > 0 ? Math.pow(Math.abs(d0) / s0 / (Math.abs(d3) / s3), 1 / 3) - 1 : null;
    var gD = dpsCagr !== null && isFinite(dpsCagr) ? clamp_(dpsCagr, 0, gT) : clamp_(avgRange(1, 10), 0, gT);
    gD = Math.min(gD, r - 0.02);
    M['Dividend discount'] = div / shares * (1 + gD) / (r - gD);
  }
  if (equity && equity > 0 && ni !== null) {
    var roe = ni / equity;
    if (roe > gT && roe <= 0.35) M['Justified P/B'] = equity / shares * (roe - gT) / (r - gT);
  }
  if (type === 'Financial' && eps !== null && eps > 0) {
    out.target5 = eps * Math.pow(1 + mean_(path.slice(0, 5)), 5) * exitMultiple_(avgRange(6, 10), S.peCap);
  }

  // Blend: models allowed for the type, positive, and within 0.2x-5x of price.
  var used = [], excluded = [];
  MODEL_NAMES.forEach(function (name) {
    var v = M[name];
    out.models[name] = v === undefined || !isFinite(v) ? null : v;
    if (out.models[name] === null || allowed.indexOf(name) < 0) return;
    if (v <= 0 || (price && (v < 0.2 * price || v > 5 * price))) { excluded.push(name); return; }
    used.push(name);
  });
  if (!used.length && excluded.length) {
    var pos = excluded.filter(function (k) { return M[k] > 0; });
    if (pos.length) {
      used = pos; excluded = [];
      out.notes.push('Caution: every model is far from the share price (below 20% or above 5x); shown anyway');
    }
  }
  var vals = used.map(function (k) { return M[k]; });
  if (vals.length) {
    out.fv = median_(vals); out.low = Math.min.apply(null, vals); out.high = Math.max.apply(null, vals);
    out.buyBelow = out.fv * (1 - S.mos);
  }
  out.used = used;
  if (excluded.length) out.notes.push('Excluded as implausible vs price: ' + excluded.join(', '));
  if (type === 'Pre-profit') out.notes.push('Speculative: values rest on assumed future margins');

  // Reverse DCF: what year-1 growth (fading to terminal) the price implies
  if (price) {
    var sol = null;
    if (fcfBase !== null && fcfBase > 0 && type !== 'Financial') {
      sol = solveGrowth_(function (g) { return dcfPerShare_(fcfBase, g, gT, r, netCash, shares); }, price);
      out.impliedBasis = 'DCF';
    } else if (hasRev && type !== 'Financial') {
      sol = solveGrowth_(function (g) { return projection5_(projRev, g, gT, mF, pfLater, shares, dilP, S.req, projYears).fv; }, price);
      out.impliedBasis = 'Revenue projection';
    }
    if (sol) { out.implied = sol.g; out.impliedNote = sol.note; }
  }

  // PEG inputs. Forward where analysts cover the stock: next-year consensus EPS and its growth into the
  // following year (both on analysts' adjusted basis). Otherwise trailing EPS with the starting growth rate.
  var estEps1 = n_(raw['Est EPS FY1']);
  if (estEps1 !== null && estEps1 > 0 && estEps2 !== null && estEps2 > 0) {
    out.pegEps = estEps1 * fx; out.epsGrowth = estEps2 / estEps1 - 1; out.epsGrowthBasis = 'Forward: consensus EPS next year to year after';
  } else {
    out.pegEps = eps; out.epsGrowth = g0; out.epsGrowthBasis = 'Trailing EPS, start growth rate';
  }
  out.expGap = typeof out.implied === 'number' ? out.implied - g0 : null;
  out.modelVsAnalysts = out.fv && out.analystTarget ? out.fv / out.analystTarget - 1 : null;

  // Metrics
  out.divYield = price && div ? div / (price * shares) : 0;
  out.grossMargin = F('GrossProfit TTM') !== null && rev ? F('GrossProfit TTM') / rev : null;
  out.opMargin = F('OperatingIncome TTM') !== null && rev ? F('OperatingIncome TTM') / rev : null;
  out.fcfMargin = fcfMarginNow;
  out.netCash = netCash;
  out.pe = price && eps > 0 ? price / eps : null;
  out.evSales = price && rev ? (price * shares - netCash) / rev : null;
  out.runway = fcf !== null && fcf < 0 ? cash / -fcf * 12 : null;
  var opInc = F('OperatingIncome TTM'), tax = F('IncomeTax TTM'), pre = F('PretaxIncome TTM');
  var tr = tax !== null && pre ? clamp_(tax / pre, 0, 0.35) : 0.21;
  var ic = (equity || 0) + debt - cash;
  out.roic = opInc !== null && ic > 0 ? opInc * (1 - tr) / ic : null;

  // Direction signals: true = improving, false = worsening, null = not available
  var sig = out.signals;
  sig.Revenue = yoy === null ? null : cagr3 !== null ? yoy >= cagr3 - 0.02 : yoy > 0;
  sig.EPS = ni !== null && ni1 !== null ? (shares1 && dil !== null ? ni / shares > ni1 / shares1 : ni > ni1) : null;
  sig.FCF = fcf !== null && fcf1 !== null ? fcf > fcf1 : null;
  var gmAvg = margins(function (i) { return fy('GrossProfit', i); });
  sig['Gross margin'] = out.grossMargin !== null && gmAvg !== null ? out.grossMargin >= gmAvg : null;
  var omAvg = margins(function (i) { return fy('OperatingIncome', i); });
  sig['Op margin'] = out.opMargin !== null && omAvg !== null ? out.opMargin >= omAvg : null;
  sig.Shares = dil === null ? null : dil <= 0.01;
  var opInc1 = F('OperatingIncome TTM 1y ago');
  sig.ROIC = out.roic !== null && out.roic >= 0.15 ? true : opInc !== null && opInc1 !== null ? opInc > opInc1 : null;
  // Analysts raising next-year EPS estimates (90-day change, else 30-day up vs down revisions)
  sig.Estimates = out.estChg90 !== null && Math.abs(out.estChg90) > 0.005 ? out.estChg90 > 0 :
    (up30 !== null && dn30 !== null && up30 + dn30 > 0 ? up30 > dn30 : null);
  var keys = Object.keys(sig), avail = keys.filter(function (k) { return sig[k] !== null; });
  out.score = avail.filter(function (k) { return sig[k]; }).length;
  out.scoreOf = avail.length;
  out.scorePct = avail.length ? out.score / avail.length : null;
  out.scoreChange = past && past.score !== null && past.score !== undefined && past.score !== '' ? out.score - past.score : null;
  out.signalText = keys.map(function (k) { return k + (sig[k] === null ? ' –' : sig[k] ? ' ↑' : ' ↓'); }).join('  ');
  return out;
}

/* ======================================================================== */
/*  STAGE 2 — SHEET WIRING: Calc, Watchlist, History, FX, rates             */
/* ======================================================================== */

var SHEET2 = { CALC: 'Calc', WATCH: 'Watchlist', HIST: 'History', FX: 'FX' };

function colL_(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; }

/* Calc columns: [header, number format, value key or formula builder]. */
var CALC_COLS = [
  ['Ticker', '@', 'ticker'], ['Name', '@', 'name'], ['List', '@', 'list'], ['Type', '@', 'type'],
  ['Sector', '@', 'sector'], ['Industry', '@', 'industry'],
  ['Price', '#,##0.00', 'F:price'], ['Currency', '@', 'ccy'],
  ['Fair value', '#,##0.00', 'fv'], ['Low', '#,##0.00', 'low'], ['High', '#,##0.00', 'high'], ['Buy below', '#,##0.00', 'buyBelow'],
  ['Upside', '0.0%;[Red]-0.0%', 'F:upside'], ['Price / fair value', '0.00', 'F:pfv'],
  ['Exp. 5-yr return (a year)', '0.0%;[Red]-0.0%', 'F:expret'],
  ['Status', '@', 'F:status'], ['Watch signal', '@', 'F:signal'],
  ['Direction', '@', 'dirText'], ['Direction %', '0%', 'scorePct'], ['Direction change (3 months)', '+0;-0;0', 'scoreChange'],
  ['Signals', '@', 'signalText'], ['Models used', '0', 'usedCount'], ['Models', '@', 'usedNames'],
  ['Implied growth (reverse DCF)', '0.0%', 'implied'], ['Start growth', '0.0%', 'g0'], ['Growth basis', '@', 'gBasis'],
  ['Discount rate', '0.0%', 'r'],
  ['DCF', '#,##0.00', 'm:DCF'], ['FCF future market cap', '#,##0.00', 'm:FCF future market cap'],
  ['5-yr earnings', '#,##0.00', 'm:5-yr earnings'], ['Fwd EPS x P/E', '#,##0.00', 'm:Fwd EPS x P/E'],
  ['Graham', '#,##0.00', 'm:Graham'], ['Lynch', '#,##0.00', 'm:Lynch'], ['Dividend discount', '#,##0.00', 'm:Dividend discount'],
  ['Justified P/B', '#,##0.00', 'm:Justified P/B'],
  ['5-yr target price', '#,##0.00', 'target5'], ['Dividend yield', '0.0%', 'divYield'],
  ['Revenue growth 1-yr', '0.0%;[Red]-0.0%', 'revYoY'], ['Revenue growth 3-yr CAGR', '0.0%;[Red]-0.0%', 'revCagr3'],
  ['Gross margin', '0.0%;[Red]-0.0%', 'grossMargin'], ['Operating margin', '0.0%;[Red]-0.0%', 'opMargin'],
  ['FCF margin', '0.0%;[Red]-0.0%', 'fcfMargin'], ['ROIC', '0.0%;[Red]-0.0%', 'roic'],
  ['Net cash (m)', '#,##0;[Red]-#,##0', 'netCashM'], ['EV / sales', '0.0', 'evSales'], ['P/E (TTM)', '0.0', 'pe'],
  ['Cash runway (months)', '0', 'runway'], ['Dilution 1-yr', '0.0%;[Red]-0.0%', 'dilution'],
  ['Data as of', '@', 'dataDate'], ['Notes', '@', 'notesText'],
  ['Analyst target', '#,##0.00', 'analystTarget'], ['Analyst target upside', '0.0%;[Red]-0.0%', 'F:tupside'],
  ['Analysts', '0', 'analysts'],
  ['EPS for PEG', '#,##0.00', 'pegEps'], ['Expected EPS growth', '0.0%;[Red]-0.0%', 'epsGrowth'], ['PEG basis', '@', 'epsGrowthBasis'],
  ['PEG', '0.00', 'F:peg'], ['Expectations gap (implied - expected growth)', '+0.0%;[Red]-0.0%', 'expGap'],
  ['Model vs analysts', '+0%;[Red]-0%', 'modelVsAnalysts'],
  ['Next earnings', '@', 'nextEarnings'], ['Last EPS surprise', '+0.0%;[Red]-0.0%', 'surprise'],
  ['EPS estimate change 30d', '+0.0%;[Red]-0.0%', 'estChg30'], ['EPS estimate change 90d', '+0.0%;[Red]-0.0%', 'estChg90'],
  ['Analyst revisions 30d', '@', 'revisionsText'], ['Sort key', '0.000', 'F:sort']
];
function calcIdx_(header) { for (var i = 0; i < CALC_COLS.length; i++) if (CALC_COLS[i][0] === header) return i + 1; throw new Error(header); }
function calcL_(header) { return colL_(calcIdx_(header)); }

function calcFormula_(key, r) {
  var c = function (h) { return calcL_(h) + r; };
  var P = c('Price'), G = c('Fair value'), H = c('High'), J = c('Buy below');
  switch (key) {
    case 'price':
      var yIdx = RAW_COLS.indexOf('Yahoo price') + 1, rawLast = colL_(RAW_COLS.length);
      return '=IF(N(IFERROR(VLOOKUP($A' + r + ',Market!$A:$D,4,FALSE),0))>0,VLOOKUP($A' + r + ',Market!$A:$D,4,FALSE),IFERROR(1/(1/VLOOKUP($A' + r + ',\'Raw Data\'!$A:$' + rawLast + ',' + yIdx + ',FALSE)),""))';
    case 'upside': return '=IF(OR(' + G + '="",' + P + '="",' + P + '=0),"",' + G + '/' + P + '-1)';
    case 'pfv': return '=IF(OR(' + G + '="",' + P + '=""),"",' + P + '/' + G + ')';
    case 'expret':
      var T = c('5-yr target price'), Y = c('Dividend yield');
      return '=IF(OR(' + T + '="",' + P + '="",N(' + P + ')<=0,N(' + T + ')<=0),"",(' + T + '/' + P + ')^(1/5)-1+N(' + Y + '))';
    case 'status':
      var M = c('Exp. 5-yr return (a year)');
      return '=IF(OR(' + G + '="",' + P + '=""),"No valuation",IF(OR(' + P + '>' + H + ',AND(' + M + '<>"",' + M + '<STRETCH_RETURN)),"Stretched",IF(' + P + '>' + G + ',"Above fair value",IF(' + P + '>=' + J + ',"Fair","Cheap"))))';
    case 'signal':
      var D = c('Type'), Q = c('Direction %'), U = c('Models used');
      return '=IF(' + D + '="Pre-profit","Speculative",IF(OR(' + G + '="",' + P + '=""),"No valuation",IF(AND(' + P + '<=' + J + ',N(' + Q + ')>=0.6,N(' + U + ')>=3),"Buy zone",IF(AND(' + P + '<=' + J + ',N(' + Q + ')<=0.4),"Value trap?",IF(' + P + '<=' + J + '*1.1,"Approaching","Wait")))))';
    case 'tupside': var AT = c('Analyst target'); return '=IF(OR(' + AT + '="",' + P + '="",' + P + '=0),"",' + AT + '/' + P + '-1)';
    case 'peg':
      var EP = c('EPS for PEG'), EG = c('Expected EPS growth');
      return '=IF(OR(' + P + '="",N(' + EP + ')<=0,N(' + EG + ')<=0.01),"",(' + P + '/' + EP + ')/(' + EG + '*100))';
    case 'sort': return '=IF(' + c('Upside') + '="",-99,' + c('Upside') + ')';
  }
}

/** Recalculates every valuation. Runs after each data load, and when settings or overrides change. */
function recalcValuations() {
  var ss = SpreadsheetApp.getActive();
  var today = dnum_(Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd'));
  var S = settingsFromMap_(assumptionsMap_());

  var raw = sheetObjects_(SHEET.RAW, 'Ticker');
  var mk = ss.getSheetByName(SHEET.MARKET);
  var mv = mk.getLastRow() > 1 ? mk.getRange(2, 1, mk.getLastRow() - 1, MARKET_HEADERS.length).getValues() : [];
  var market = {};
  mv.forEach(function (r) {
    var cur = String(r[4] || '').trim();
    market[String(r[0]).toUpperCase()] = { name: typeof r[2] === 'string' && r[2].charAt(0) !== '=' ? r[2] : '', price: typeof r[3] === 'number' ? r[3] : null,
      currency: /^[A-Z]{3}$/.test(cur) ? cur : '',
      shares: typeof r[6] === 'number' ? r[6] : null, beta: typeof r[7] === 'number' ? r[7] : null };
  });
  var tk = ss.getSheetByName(SHEET.TICKERS);
  var tv = tk.getLastRow() > 1 ? tk.getRange(2, 1, tk.getLastRow() - 1, 7).getValues() : [];
  var hist = historyIndex_(today);
  var hs = ss.getSheetByName(SHEET.HOLDINGS), held = {};
  if (hs.getLastRow() > 1) hs.getRange(2, 1, hs.getLastRow() - 1, 1).getValues().forEach(function (r) { var t = String(r[0]).trim().toUpperCase(); if (t) held[t] = 1; });

  // Exchange rates: reported currency -> listing currency
  var need = {};
  tv.forEach(function (r) {
    var t = String(r[0]).trim().toUpperCase(), rw = raw[t], m = market[t];
    if (rw && rw.Currency && m && m.currency && rw.Currency !== m.currency) {
      if (m.currency === 'GBX') { if (rw.Currency !== 'GBP') need[rw.Currency + 'GBP'] = 1; }
      else need[rw.Currency + m.currency] = 1;
    }
  });
  var fx = fxRates_(Object.keys(need));

  var out = [];
  tv.forEach(function (r) {
    var t = String(r[0]).trim().toUpperCase();
    if (!t) return;
    var rw = raw[t] || { Ticker: t, Status: 'Waiting for data' }, m = market[t] || {};
    var rate;
    if (!rw.Currency || !m.currency || rw.Currency === m.currency) rate = 1;
    else if (m.currency === 'GBX') rate = rw.Currency === 'GBP' ? 100 : (fx[rw.Currency + 'GBP'] ? fx[rw.Currency + 'GBP'] * 100 : null);   // pence
    else rate = fx[rw.Currency + m.currency] || null;
    var v;
    try {
      v = valueCompany(rw, m, rate, { type: r[4], growth: r[5], margin: r[6] }, S, hist[t] || null, today);
    } catch (e) { v = { type: 'Error', notes: [e.message], models: {}, signals: {} }; }
    v.sector = rw.Sector || '';
    v.industry = rw['Yahoo industry'] || (rw.Industry ? String(rw.Industry).toLowerCase().replace(/(^|[\s&-])\w/g, function (x) { return x.toUpperCase(); }) : '');
    v.ticker = t; v.name = m.name || rw['SEC name'] || ''; v.list = held[t] ? 'Holding' : 'Watchlist'; v.ccy = m.currency || '';
    v.dirText = v.scoreOf ? v.score + '/' + v.scoreOf : '';
    v.usedCount = v.used ? v.used.length : '';
    v.usedNames = v.used ? v.used.join(', ') : '';
    v.netCashM = v.netCash === undefined || v.netCash === null ? '' : v.netCash / 1e6;
    if (v.implied === null && v.impliedNote) v.implied = v.impliedNote;
    v.notesText = (v.notes || []).join('; ');
    out.push(v);
  });

  var sh = ensureSheet_(SHEET2.CALC, CALC_COLS.map(function (c) { return c[0]; }));
  sh.setFrozenColumns(1);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, CALC_COLS.length).clearContent();
  if (!out.length) return;
  var rows = out.map(function (v, i) {
    var r = i + 2;
    return CALC_COLS.map(function (c) {
      var key = c[2];
      if (key.indexOf('F:') === 0) return calcFormula_(key.slice(2), r);
      var val = key.indexOf('m:') === 0 ? (v.models || {})[key.slice(2)] : v[key];
      return val === undefined || val === null || (typeof val === 'number' && !isFinite(val)) ? '' : val;
    });
  });
  sh.getRange(2, 1, rows.length, CALC_COLS.length).setValues(rows);
  CALC_COLS.forEach(function (c, i) { sh.getRange(2, i + 1, rows.length, 1).setNumberFormat(c[1]); });

  snapshotHistory_(out, today);
}

function assumptionsMap_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET.ASSUME), m = {};
  if (sh.getLastRow() < 1) return m;
  sh.getRange(1, 1, sh.getLastRow(), 2).getValues().forEach(function (r) { m[String(r[0]).trim()] = r[1]; });
  return m;
}

function sheetObjects_(name, key) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name), out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues(), h = v[0];
  v.slice(1).forEach(function (r) {
    var o = {};
    h.forEach(function (x, i) { o[x] = r[i] instanceof Date ? Utilities.formatDate(r[i], 'UTC', 'yyyy-MM-dd') : r[i]; });
    if (o[key]) out[String(o[key]).toUpperCase()] = o;
  });
  return out;
}

/** FX tab: one GOOGLEFINANCE rate per currency pair needed (e.g. EURUSD). */
function fxRates_(pairs) {
  var sh = ensureSheet_(SHEET2.FX, ['Pair', 'Rate']);
  var have = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues() : [];
  var known = have.map(function (r) { return String(r[0]); });
  var add = pairs.filter(function (p) { return /^[A-Z]{6}$/.test(p) && known.indexOf(p) < 0; });
  if (add.length) {
    var start = have.length + 2;
    sh.getRange(start, 1, add.length, 2).setValues(add.map(function (p, k) {
      return [p, '=GOOGLEFINANCE("CURRENCY:' + p + '")'];
    }));
    SpreadsheetApp.flush();
    have = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  }
  var out = {};
  have.forEach(function (r) { if (typeof r[1] === 'number' && r[1] > 0) out[String(r[0])] = r[1]; });
  return out;
}

/** History: weekly snapshot of price, fair value and direction score per ticker. */
function historyIndex_(today) {
  var sh = ensureSheet_(SHEET2.HIST, ['Date', 'Ticker', 'Price', 'Fair value', 'Direction score']);
  var out = {};
  if (sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues().forEach(function (r) {
    var d = r[0] instanceof Date ? dnum_(Utilities.formatDate(r[0], 'UTC', 'yyyy-MM-dd')) : null;
    if (d === null) return;
    var age = today - d;
    if (age < 60 || age > 120) return;
    var t = String(r[1]).toUpperCase(), cur = out[t];
    if (!cur || Math.abs(age - 90) < Math.abs(cur.age - 90)) out[t] = { age: age, fv: typeof r[3] === 'number' ? r[3] : null, score: r[4] };
  });
  return out;
}

function snapshotHistory_(rows, today) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET2.HIST);
  var last = sh.getLastRow() > 1 ? sh.getRange(sh.getLastRow(), 1).getValue() : null;
  var lastDay = last instanceof Date ? dnum_(Utilities.formatDate(last, 'UTC', 'yyyy-MM-dd')) : -1;
  if (today - lastDay < 7) return;
  var mk = {};
  var mv = SpreadsheetApp.getActive().getSheetByName(SHEET.MARKET);
  if (mv.getLastRow() > 1) mv.getRange(2, 1, mv.getLastRow() - 1, 4).getValues().forEach(function (r) { mk[String(r[0]).toUpperCase()] = r[3]; });
  var now = new Date();
  var add = rows.filter(function (v) { return v.fv; }).map(function (v) {
    return [now, v.ticker, typeof mk[v.ticker] === 'number' ? mk[v.ticker] : '', v.fv, v.score === undefined ? '' : v.score];
  });
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, 5).setValues(add);
}

/** Bond yields from data/rates.csv (written by the GitHub job from FRED). */
function loadRates_(rawUrl) {
  try {
    var url = rawUrl.replace(/raw_data\.csv.*$/, 'rates.csv');
    var res = UrlFetchApp.fetch(url + '?t=' + Date.now(), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return;
    var rows = Utilities.parseCsv(res.getContentText()), vals = {};
    rows.slice(1).forEach(function (r) { vals[r[0]] = Number(r[2]) / 100; });
    var sh = SpreadsheetApp.getActive().getSheetByName(SHEET.ASSUME);
    var labels = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
    labels.forEach(function (l, i) {
      var lab = String(l[0]).trim();
      if (lab === 'Risk-free rate (10-yr Treasury)' && vals.DGS10 > 0) sh.getRange(i + 1, 2).setValue(vals.DGS10);
      if (lab === 'AAA corporate bond yield' && vals.AAA > 0) sh.getRange(i + 1, 2).setValue(vals.AAA);
    });
  } catch (e) { log_('', 'Could not load bond yields: ' + e.message); }
}

/** Adds any missing Stage 2 settings rows to Assumptions (existing values are kept). */
function ensureSettings_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET.ASSUME);
  var have = assumptionsMap_();
  var start = sh.getLastRow() + 1, added = 0;
  if (!('Valuation settings' in have)) {
    sh.getRange(start + 1, 1).setValue('Valuation settings').setFontWeight('bold');
    start += 2;
  }
  SETTINGS.forEach(function (s) {
    if (s[0] in have) return;
    var r = start + added;
    sh.getRange(r, 1, 1, 3).setValues([[s[0], s[1], s[3]]]);
    sh.getRange(r, 2).setNumberFormat(s[2]).setBackground('#FFF4CC');
    added++;
  });
  nameSetting_('Stretched if 5-yr expected return below', 'STRETCH_RETURN');
}

/** Holdings: valuation columns to the right of the existing ones (from column N). */
var HOLDINGS_COLS = [
  ['Sector', 'Sector', '@', 120], ['Industry', 'Industry', '@', 170], ['Type', 'Type', '@', 100],
  ['Fair value (local)', 'Fair value', '#,##0.00', 90], ['Low', 'Low', '#,##0.00', 75], ['High', 'High', '#,##0.00', 75],
  ['Upside', 'Upside', '0.0%;[Red]-0.0%', 70], ['Exp. return a year (5 yrs)', 'Exp. 5-yr return (a year)', '0.0%;[Red]-0.0%', 85],
  ['Direction', 'Direction', '@', 70], ['Status', 'Status', '@', 120], ['Review', null, '@', 240],
  ['Analyst target', 'Analyst target', '#,##0.00', 85], ['PEG', 'PEG', '0.00', 60],
  ['Expectations gap', 'Expectations gap (implied - expected growth)', '+0.0%;[Red]-0.0%', 90],
  ['Model vs analysts', 'Model vs analysts', '+0%;[Red]-0%', 85],
  ['Next earnings', 'Next earnings', '@', 110], ['Last EPS surprise', 'Last EPS surprise', '+0.0%;[Red]-0.0%', 80],
  ['EPS est. change 90d', 'EPS estimate change 90d', '+0.0%;[Red]-0.0%', 80], ['Revisions 30d', 'Analyst revisions 30d', '@', 100]
];
var HOLDINGS_FIRST = 14;

function writeHoldingsValuation_(formulasOnly) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET.HOLDINGS);
  var heads = HOLDINGS_COLS.map(function (c) { return c[0]; });
  sh.getRange(1, HOLDINGS_FIRST, 1, heads.length).setValues([heads]).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F3A5F').setWrap(true);
  var last = colL_(CALC_COLS.length);
  var look = function (h) { return 'IFERROR(VLOOKUP(A2:A,Calc!$A:$' + last + ',' + calcIdx_(h) + ',FALSE),"")'; };
  HOLDINGS_COLS.forEach(function (c, i) {
    var col = HOLDINGS_FIRST + i;
    var body = c[1] ? look(c[1]) : 'TRIM(IF(N(M2:M)>0.15,"Over 15% of portfolio. ","")&IF(N(' + look('Direction change (3 months)') + ')<=-2,"Direction score fell 2+ in 3 months.",""))';
    sh.getRange(2, col).setFormula('=ARRAYFORMULA(IF(A2:A="",,' + body + '))');
    sh.getRange(2, col, 499, 1).setNumberFormat(c[2]);
    if (!formulasOnly) sh.setColumnWidth(col, c[3]);
  });
}
function holdingsCol_(header) {
  for (var i = 0; i < HOLDINGS_COLS.length; i++) if (HOLDINGS_COLS[i][0] === header) return colL_(HOLDINGS_FIRST + i);
}

/** Watchlist: watched (not held) stocks, best upside first. [header, Calc column, format] */
var WATCH_COLS = [
  ['Ticker', 'Ticker', '@'], ['Name', 'Name', '@'], ['Sector', 'Sector', '@'], ['Industry', 'Industry', '@'], ['Type', 'Type', '@'],
  ['Price', 'Price', '#,##0.00'], ['Currency', 'Currency', '@'], ['Fair value', 'Fair value', '#,##0.00'],
  ['Buy below', 'Buy below', '#,##0.00'], ['Upside', 'Upside', '0.0%;[Red]-0.0%'],
  ['Exp. return a year (5 yrs)', 'Exp. 5-yr return (a year)', '0.0%;[Red]-0.0%'], ['Direction', 'Direction', '@'],
  ['Signal', 'Watch signal', '@'], ['Implied growth', 'Implied growth (reverse DCF)', '0.0%'],
  ['Cash runway (months)', 'Cash runway (months)', '0'], ['Dilution 1-yr', 'Dilution 1-yr', '0.0%;[Red]-0.0%'],
  ['Analyst target', 'Analyst target', '#,##0.00'], ['PEG', 'PEG', '0.00'],
  ['Expectations gap', 'Expectations gap (implied - expected growth)', '+0.0%;[Red]-0.0%'],
  ['Model vs analysts', 'Model vs analysts', '+0%;[Red]-0%'],
  ['Next earnings', 'Next earnings', '@'], ['Last EPS surprise', 'Last EPS surprise', '+0.0%;[Red]-0.0%'],
  ['EPS est. change 90d', 'EPS estimate change 90d', '+0.0%;[Red]-0.0%'], ['Revisions 30d', 'Analyst revisions 30d', '@'],
  ['Notes', 'Notes', '@']
];
function watchCol_(header) {
  for (var i = 0; i < WATCH_COLS.length; i++) if (WATCH_COLS[i][0] === header) return colL_(i + 1);
}

function writeWatchlist_(formulasOnly) {
  var heads = WATCH_COLS.map(function (c) { return c[0]; });
  var sh = ensureSheet_(SHEET2.WATCH, heads);
  if (sh.getMaxColumns() > heads.length) sh.getRange(1, heads.length + 1, 1, sh.getMaxColumns() - heads.length).clearContent();
  sh.getRange(1, 1, 1, heads.length).setFontColor('#FFFFFF').setBackground('#1F3A5F').setWrap(true);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getMaxRows() - 1, sh.getMaxColumns()).clearContent();
  var arr = '{' + WATCH_COLS.map(function (c) { return 'Calc!' + calcL_(c[1]) + '2:' + calcL_(c[1]); }).join(',') + '}';
  var cond = 'Calc!C2:C="Watchlist"';
  sh.getRange('A2').setFormula('=IFERROR(SORT(FILTER(' + arr + ',' + cond + '),FILTER(Calc!' + calcL_('Sort key') + '2:' +
    calcL_('Sort key') + ',' + cond + '),FALSE),"Run Valuation ▸ Recalculate valuations")');
  WATCH_COLS.forEach(function (c, i) { sh.getRange(2, i + 1, 499, 1).setNumberFormat(c[2]); });
  if (!formulasOnly) { sh.setColumnWidth(2, 200); sh.setColumnWidth(3, 120); sh.setColumnWidth(4, 170); sh.setColumnWidth(WATCH_COLS.length, 360); }
}

/** Colours for Status and Signal columns (replaces earlier rules on these tabs). */
function writeColourRules_() {
  var ss = SpreadsheetApp.getActive();
  var colours = { 'Stretched': '#F4C7C3', 'Above fair value': '#FCE8B2', 'Fair': '#E8EAED', 'Cheap': '#B7E1CD',
    'Buy zone': '#B7E1CD', 'Approaching': '#D9EAD3', 'Value trap?': '#FCE8B2', 'Speculative': '#D9D2E9' };
  var apply = function (sh, a1) {
    var range = sh.getRange(a1), rules = [];
    Object.keys(colours).forEach(function (k) {
      rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(k).setBackground(colours[k]).setRanges([range]).build());
    });
    sh.setConditionalFormatRules(rules);
  };
  apply(ss.getSheetByName(SHEET.HOLDINGS), holdingsCol_('Status') + '2:' + holdingsCol_('Status') + '500');
  apply(ss.getSheetByName(SHEET2.WATCH), watchCol_('Signal') + '2:' + watchCol_('Signal') + '500');
  apply(ss.getSheetByName(SHEET2.CALC), calcL_('Status') + '2:' + calcL_('Watch signal') + '500');
}

/* Lets the parsing functions be tested outside Google (ignored by Apps Script). */
if (typeof module !== 'undefined') {
  module.exports = { TAGS: TAGS, valueCompany: valueCompany, settingsFromMap_: settingsFromMap_, dnum_: dnum_, CALC_COLS: CALC_COLS, parseCompany: parseCompany, parseCsv: parseCsv, buildRawRows: buildRawRows, RAW_COLS: RAW_COLS };
}
