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
    'Revisions up 30d', 'Revisions down 30d', 'Est EPS growth 5y', 'Yahoo market cap',
    '12m price change', 'Price vs 200d avg', 'Price vs 50d avg', 'Off 52w high');
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
    .addItem('Recalculate valuations and orders', 'recalcValuations')
    .addItem('Rebuild Market tab', 'rebuildMarket')
    .addItem('Repair formulas (after sorting)', 'repairFormulas')
    .addSeparator()
    .addItem('Open selected ticker in Stock view', 'openInStockView')
    .addItem('Rebuild Stock view tab', 'rebuildStockView')
    .addToUi();
}

/** Simple trigger: keeps the Market tab in step when you edit ticker lists. */
function onEdit(e) {
  try {
    var name = e.range.getSheet().getName();
    if ((name === SHEET.TICKERS || name === SHEET.HOLDINGS) && e.range.getColumn() <= 2) { syncMarket_(); recalcValuations(); }
    if (name === SHEET.ASSUME || (name === SHEET.TICKERS && e.range.getColumn() >= 5 && e.range.getColumn() <= 7)) recalcValuations();
    if (name === ORDERS.NAME && e.range.getColumn() === 1 && e.range.getRow() > 1 && e.range.getValue() === true) {
      executeOrder_(e.range.getRow()); recalcValuations(); return;
    }
    if (name === SV.NAME) {
      var a1 = e.range.getA1Notation();
      if (a1 === SV.TICKER) renderStockView_();
      else if (a1 === SV.NOTE_CELL || a1 === SV.NOTE_RANGE) saveNote_(String(e.range.getSheet().getRange(SV.TICKER).getValue()).trim().toUpperCase(), e.range.getValue());
    }
  } catch (err) { /* never block an edit */ }
}

function rebuildStockView() { buildStockView_(); SpreadsheetApp.getActive().toast('Stock view rebuilt.', 'Valuation', 5); }

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
  writeSetups_();
  writeRulesTab_();
  recalcValuations();
  writeColourRules_();
  buildStockView_();

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
  if (ss.getSheetByName(SHEET2.CALC)) { writeHoldingsValuation_(true); writeWatchlist_(true); if (ss.getSheetByName(SHEET2.SETUPS)) writeSetups_(true); }
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
    try { renderStockView_(); } catch (err) { /* view not built yet */ }

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
function fixScaleSlips_(F, anchor) {
  var eps = keyMap_(F.EPS.merged), sh = keyMap_(F.DilutedShares.merged), rev = keyMap_(F.Revenue.merged);
  var fixed = {}, notes = [];
  // Share counts 1,000x (or 1,000,000x) away from the latest cover-page share count are filer slips.
  if (anchor > 0) {
    var med = anchor;
    F.DilutedShares.byTag.forEach(function (s) {
      s.forEach(function (f) {
        if (!(f.val > 0)) return;
        var lr = Math.log(f.val / med) / Math.LN10 / 3, st = Math.round(lr);
        if (st !== 0 && Math.abs(lr - st) < 0.2) { f.val = f.val / Math.pow(1000, st); fixed[f.start + '|' + f.end] = 1; notes.push('share count ' + f.end); }
      });
    });
  }
  F.NetIncome.byTag.forEach(function (s) {
    s.forEach(function (f) {
      var k = f.start + '|' + f.end, e = eps[k], n = sh[k];
      if (!e || !n || !e.val || !n.val || !f.val) return;
      if (Math.abs(e.val) < 0.05) return;            // EPS rounded to a cent: the identity is too noisy to judge scale
      var r = f.val / (e.val * n.val);
      if (r <= 0) return;
      var lr = Math.log(r) / Math.LN10 / 3, step = Math.round(lr);
      if (step === 0 || Math.abs(lr - step) > 0.25) return;
      var rv = rev[k];
      if (!rv || !rv.val) return;
      var niPlausible = Math.abs(f.val) * 300 >= Math.abs(rv.val) && Math.abs(f.val) <= 300 * Math.abs(rv.val);
      if (!niPlausible) { f.val = f.val / Math.pow(1000, step); notes.push('net income ' + f.end); }
      else if (!fixed[k]) {
        var nv = n.val * Math.pow(1000, step);
        // Only accept if the repaired count is closer to the cover-page share count (when known)
        if (anchor > 0 && Math.abs(Math.log(nv / anchor)) >= Math.abs(Math.log(n.val / anchor))) return;
        n.val = nv; fixed[k] = 1; notes.push('share count ' + f.end);
      }
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
  var coverS = facts.facts.dei && facts.facts.dei.EntityCommonStockSharesOutstanding ?
    instantSeries_(facts.facts.dei, ['EntityCommonStockSharesOutstanding'], 'shares', ccy) : [];
  var slips = fixScaleSlips_(F, coverS.length ? coverS[0].val : null);
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
  ['Subtract stock-based comp from FCF', 'Yes', '@', 'Yes or No. Yes treats stock pay as the real cost it is (shareholders pay through dilution).'],
  ['Growth stock threshold (3-yr revenue CAGR)', 0.15, '0%', 'Profitable companies whose average of 1-yr and 3-yr revenue growth exceeds this are classed as Growth.'],
  ['Default long-run FCF margin (pre-profit)', 0.15, '0%', 'Used when a company has no positive margin history. Per-stock override on Tickers.'],
  ['Default long-run net margin (pre-profit)', 0.12, '0%', ''],
  ['Stretched if 5-yr expected return below', 0.06, '0%', ''],
  ['Max growth after forecast years', 0.25, '0%', 'After the analysts\' forecast years, growth fades to the terminal rate starting from at most this.'],
  ['Max data age (months)', 15, '0', 'Older SEC data is not valued.'],
  ['Cash available (£)', 0, '£#,##0', 'PORTFOLIO RULES. Uninvested cash in your account. Updated automatically when you tick an order Done on the Orders tab; correct it here after trades.'],
  ['Cash reserve', 0.05, '0%', 'Share of the portfolio always kept in cash.'],
  ['Max position (best ideas)', 0.10, '0.0%', 'Target size for the strongest opportunities. Weaker qualifying stocks get down to 40% of this.'],
  ['Min position', 0.04, '0.0%', 'Smallest full position worth holding. When more stocks qualify than the portfolio has room for at this size, only the strongest are bought; the rest wait.'],
  ['Max position (cyclical)', 0.06, '0.0%', 'Memory, storage, metals and other boom-and-bust stocks.'],
  ['Max position (speculative)', 0.02, '0.0%', 'Loss-making, thinly covered or unqualified stocks. Holdings above 1.5x this are trimmed back to it.'],
  ['Max per industry', 0.35, '0%', 'New buys stop once an industry reaches this share of the portfolio.'],
  ['Trim if any position above', 0.15, '0%', 'Any holding above this is trimmed back to its target.'],
  ['Minimum order (£)', 250, '£#,##0', 'Smaller orders are skipped.'],
  ['Days between adds', 28, '0', 'Below the 200-day average, positions are built in thirds, at least this many days apart (or sooner on a further 10% fall).'],
  ['Max new money per week', 0.25, '0%', 'Pace limit: buys in any 7 days stop at this share of the cash available at the start of that week. 100% = no limit.'],
  ['Max new positions per week', 4, '0', 'At most this many first-time buys in any 7 days (adds to existing holdings do not count).'],
  ['Weeks of warnings before selling', 4, '0', 'A warning setup (Value, estimates falling / Trend broken / High debt / Cash burner) first halves the position; if it lasts this many weekly snapshots, the rest is sold.']
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
    req: num('Required return (5-year models)'), gCap: num('Starting growth cap'), gFadeCap: num('Max growth after forecast years'), gFloor: num('Growth floor'),
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
function growthPath_(g0, gT, lead) {
  var p = [];
  if (lead && lead.n > 0) {
    // Years 1..n at the analysts' forecast growth, then a linear fade from g0 to terminal by year 10.
    for (var t = 1; t <= 10; t++) p.push(t <= lead.n ? lead.g : g0 + (gT - g0) * (t - lead.n - 1) / (9 - lead.n));
    return p;
  }
  for (var u = 1; u <= 10; u++) p.push(g0 + (gT - g0) * (u - 1) / 9);
  return p;
}
function grow_(base, path, years) { var v = base; for (var t = 0; t < years; t++) v *= 1 + path[t]; return v; }
function exitMultiple_(laterGrowth, cap) { return clamp_(8.5 + 2 * laterGrowth * 100, 8, cap); }

/** Two-stage DCF per share: 10 years on the growth path, then a terminal value. */
function dcfPerShare_(fcf0, g0, gT, r, netCash, shares, lead) {
  var path = growthPath_(g0, gT, lead), cf = fcf0, pv = 0;
  for (var t = 1; t <= 10; t++) { cf *= 1 + path[t - 1]; pv += cf / Math.pow(1 + r, t); }
  var tv = cf * (1 + gT) / (r - gT) / Math.pow(1 + r, 10);
  return (pv + tv + netCash) / shares;
}

/** Revenue-based 5-year projection: revenue x margin x exit multiple, per future share, discounted. */
function projection5_(rev0, g0, gT, margin, mult, shares, dil, req, years, lead) {
  var path = growthPath_(g0, gT, lead);
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
  out.mom12 = n_(raw['12m price change']); out.vs200 = n_(raw['Price vs 200d avg']);
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

  if (!shares) { out.type = 'No share count'; return out; }
  // Share count implied by market value / price matches the security actually quoted (ADR ratios, share classes).
  var mcap = n_(mkt.mcap) || n_(raw['Yahoo market cap']);
  var listingGBX = mkt.currency === 'GBX' || raw.CIK === 'LSE';
  var implied = !listingGBX && mcap && price ? mcap / price : null;
  var usedImplied = false;
  if (implied && (shares / implied > 1.5 || shares / implied < 0.67)) {
    out.notes.push('Share count set from market value / price (' + (shares / implied).toFixed(2) + 'x the filed count: ADR ratio, share classes or new issuance)');
    shares = implied; usedImplied = true;
  }
  var cover = n_(raw['Shares outstanding']);
  if (!usedImplied && cover && cover / shares >= 1.5 && cover / shares <= 3 && !(gShares && gShares / shares < 1.3)) {
    shares = cover; out.notes.push('Share count raised to the latest cover-page figure (new shares issued since the last quarter)');
  }
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
  var cyclicalSic = (sic >= 1000 && sic <= 1499) || (sic >= 2800 && sic <= 2829) || (sic >= 2840 && sic <= 2999) || (sic >= 3300 && sic <= 3399) ||
    (sic >= 3670 && sic <= 3679) || sic === 3572 || (sic >= 3711 && sic <= 3716) || (sic >= 4400 && sic <= 4499);
  var established = (fy('Revenue', 3) || 0) >= 5e9;
  // Cycle trough: an established cyclical company losing money now but profitable over its last three fiscal years
  // (median net margin 3%+). Valued on typical-cycle margins instead of as a loss-maker.
  var prevNet = [];
  for (var pi = 1; pi <= 3; pi++) { var pn = fy('NetIncome', pi), pr = fy('Revenue', pi); if (pn !== null && pr) prevNet.push(pn / pr); }
  var trough = cyclicalSic && established && ni !== null && ni <= 0 && prevNet.length >= 2 && median_(prevNet) >= 0.03 && rev > 0;
  out.cycleTrough = trough;
  var type;
  var ovType = String(ovr.type || '').trim();
  if (ovType && MODELS_BY_TYPE[ovType]) { type = ovType; out.notes.push('Type set by override'); }
  // Banks, brokers, insurers (6311-6411: their cash flow includes policyholders' premiums, so free-cash-flow
  // models overstate them; health plans, 6324, excluded as they run like service businesses) and investment
  // trusts are valued as financials.
  else if (((sic >= 6000 && sic <= 6299) || (sic >= 6311 && sic <= 6411 && sic !== 6324) || sic === 6726) && !(rev && capex / rev > 0.1)) type = 'Financial';
  else if ((raw.CIK === 'LSE' && !raw.Sector) || ((raw.CIK === 'LSE' || raw.CIK === 'YAHOO') && (raw.Sector === 'Financial Services' || raw.Sector === 'Real Estate'))) type = 'Financial';
  else if ((ni === null || ni <= 0) && !trough) type = 'Pre-profit';
  else if ((mean_([yoy, cagr3]) || 0) >= S.growthThreshold) type = 'Growth';
  else type = 'Mature';
  out.type = type;

  // Starting growth, path and discount rate
  var g0, basis;
  var ovG = n_(ovr.growth);
  var estRev2 = F('Est revenue FY2'), estEps2 = n_(raw['Est EPS FY2']);
  var consensus = estRev2 !== null && estRev2 > 0 && r0 !== null && r0 > 0;
  if (consensus && r0 >= 25e6 && (estRev2 / r0 < 0.4 || estRev2 / r0 > 4)) {
    consensus = false;
    out.notes.push('Analyst revenue forecast uses a different revenue definition (' + (estRev2 / r0).toFixed(2) + 'x reported); history used for growth');
  }
  var estRev1m = F('Est revenue FY1'), latestEndM = raw['Latest period end'];
  if (consensus && estRev1m > 0 && rev > 0 && estRev1m < 0.85 * rev && raw['Est FY1 end'] && latestEndM &&
      (dnum_(String(raw['Est FY1 end']).slice(0, 10)) - dnum_(String(latestEndM).slice(0, 10))) / 365.25 <= 0.6) {
    consensus = false;
    out.notes.push('Analysts\' revenue for this year is ' + Math.round((1 - estRev1m / rev) * 100) + '% below the latest 12 months: a different revenue definition; history used for growth');
  }
  var fy0End = raw['Latest FY end'], fy2End = raw['Est FY2 end'] || '';
  var estYears = fy0End && fy2End ? clamp_((dnum_(String(fy2End).slice(0, 10)) - dnum_(String(fy0End).slice(0, 10))) / 365.25, 1, 3.5) : 2;
  var yearsAhead = fy2End ? clamp_((dnum_(String(fy2End).slice(0, 10)) - today) / 365.25, 0.5, 3) : 2;
  var gridG = n_(ovr.gridGrowth);   // set only by the Stock view sensitivity grid
  // Consensus path: growth from the latest 12 months (the base every model projects from) to the analysts'
  // second-year revenue, over the time actually left until then. Measuring from the last full fiscal year
  // would count the part of this year already reported twice.
  var latestEnd = raw['Latest period end'] ? dnum_(String(raw['Latest period end']).slice(0, 10)) : null;
  var yrsToFY2 = consensus && latestEnd !== null && fy2End ? clamp_((dnum_(String(fy2End).slice(0, 10)) - latestEnd) / 365.25, 0.75, 3.5) : (estYears || 2);
  var revBase = rev > 0 ? rev : r0;
  var gCons = consensus ? Math.pow(estRev2 / revBase, 1 / yrsToFY2) - 1 : null;
  if (ovG !== null && gridG === null) { g0 = ovG > 1.5 ? ovG / 100 : ovG; basis = 'Override'; }
  else if (consensus) {
    g0 = gCons;
    basis = 'Analyst consensus revenue growth (' + (n_(raw['Est analysts']) || '?') + ' analysts, ' + (raw['Est source'] || 'estimates') + ')';
  } else {
    var avg = mean_([yoy, cagr3]);
    g0 = avg === null ? S.gTerm : avg;
    basis = yoy !== null && cagr3 !== null ? 'Avg of 1-yr and 3-yr revenue growth' : yoy !== null ? '1-yr revenue growth' : cagr3 !== null ? '3-yr revenue growth' : 'No history (terminal rate)';
  }
  var g0raw = g0;
  var leadOK = consensus && ovG === null && ni !== null && ni > 0 && type !== 'Financial' && (n_(raw['Est analysts']) || 0) >= 5;
  // Sensitivity grid without an analyst path: the scenario growth replaces the start rate.
  if (gridG !== null && !leadOK) { g0 = gridG; g0raw = gridG; basis = 'Sensitivity scenario'; }
  g0 = clamp_(g0, S.gFloor, gridG !== null && !leadOK ? Math.max(S.gCap, gridG) : S.gCap);
  // Profitable companies with 5+ analysts: follow the consensus revenue path to the second forecast year (even
  // above the cap), then fade from the analysts' growth in that year (capped). Loss-makers and thinly covered
  // stocks use one capped start rate that fades from year 1.
  var lead = null;
  if (leadOK) {
    // Analysts' growth until their second forecast year, then a fade that starts from their growth in that
    // year (FY1 to FY2), never above the cap.
    var nLead = Math.max(1, Math.min(2, Math.round(yrsToFY2)));
    var leadG = Math.min(Math.pow(estRev2 / revBase, 1 / nLead) - 1, 1);
    var estRev1 = F('Est revenue FY1');
    var y2g = estRev1 > 0 ? estRev2 / estRev1 - 1 : g0raw;
    // Fade start: the lower of the analysts' second-year growth and their average pace to that year (so a dip
    // and rebound is not read as lasting momentum), capped for the years beyond the forecasts.
    g0 = clamp_(Math.min(y2g, g0raw), S.gTerm, Math.min(S.gCap, S.gFadeCap || 0.25));
    // Sensitivity grid: shift the whole analyst path (forecast years and fade start) by the scenario's difference.
    if (gridG !== null) {
      var dG = gridG - leadG;
      leadG = Math.max(gridG, -0.5);
      g0 = clamp_(g0 + dG, S.gFloor, Math.max(Math.min(S.gCap, S.gFadeCap || 0.25), g0 + dG));
      basis = 'Sensitivity scenario';
    }
    lead = { g: leadG, n: nLead };
    if (gridG === null) basis += ' for ' + nLead + ' year' + (nLead > 1 ? 's' : '') + ', then fading from ' + Math.round(g0 * 100) + '%';
  } else if (g0 !== g0raw && basis !== 'Override' && gridG === null) basis += g0raw > g0 ? ' (capped)' : ' (floored)';
  if (trough && !consensus && ovG === null && gridG === null && g0 < S.gTerm) { g0 = S.gTerm; basis = 'Cycle trough: terminal growth assumed'; }
  var gT = S.gTerm, path = growthPath_(g0, gT, lead);
  var avgRange = function (a, b) { return mean_(path.slice(a - 1, b)); };
  out.g0 = lead ? lead.g : g0; out.gBasis = basis;

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
  // FY margin lists for median-based targets (robust to one-off years)
  var fyMargins = function (num) {
    var a = [];
    for (var i = 0; i <= 3; i++) { var x = num(i), rv = fy('Revenue', i); if (x !== null && rv) a.push(x / rv); }
    return a;
  };
  var netFY = fyMargins(function (i) { return fy('NetIncome', i); });
  var fcfFY = fyMargins(function (i) { var o = fy('OCF', i), c = fy('Capex', i) || 0; return o === null ? null : o - c; });
  var medNet = netFY.length >= 2 ? median_([netMarginNow].concat(netFY).filter(function (x) { return x !== null; })) : null;
  var medFcf = fcfFY.length >= 2 ? median_([fcfMarginNow].concat(fcfFY).filter(function (x) { return x !== null; })) : null;
  var mF = ovM !== null ? ovM : (medFcf !== null ? medFcf : mean_([fcfMarginNow, fcfMarginAvg]));
  if (ovM === null && (mF === null || mF <= 0) && netMarginNow > 0) mF = mean_([netMarginNow, netMarginAvg > 0 ? netMarginAvg : null]);
  if (mF === null || mF <= 0) { mF = S.defFcfMargin; if (ovM === null && type !== 'Financial') out.notes.push('Default FCF margin used'); }
  var mN = ovM !== null ? ovM : (medNet !== null ? medNet : mean_([netMarginNow, netMarginAvg]));
  if (mN === null || mN <= 0) { mN = S.defNetMargin; if (ovM === null && type !== 'Financial') out.notes.push('Default net margin used'); }
  mF = Math.min(mF, 0.6); mN = Math.min(mN, 0.6);

  // Deep cyclical: an established company in a cyclical industry (chips, memory and storage, metals, chemicals, autos,
  // shipping, mining) that made a loss or near-zero profit (net margin under 3%) in one of its last four fiscal years.
  // Steady high-margin growers (no bad year) are not treated as cyclical.
  // Commodity-style swings show in gross margin too (one-off charges only hit net income): range of 15+ points.
  var gmFY = fyMargins(function (i) { return fy('GrossProfit', i); });
  if (out.grossMarginNow === undefined && F('GrossProfit TTM') !== null && rev) gmFY.push(F('GrossProfit TTM') / rev);
  var gmSwing = gmFY.length >= 3 ? Math.max.apply(null, gmFY) - Math.min.apply(null, gmFY) : 0;
  var deepCyc = cyclicalSic && established && netFY.some(function (x) { return x < 0.03; }) && gmSwing >= 0.15;
  out.deepCyclical = deepCyc;
  // Cyclical peak: a deep cyclical with revenue up 50%+ in a year, earning well above its cycle-average margin
  // (over 1.5x, and over 15%). Long-run margins are set halfway between today's and the cycle average (this year
  // and the last four fiscal years, losses included): nobody knows when a boom ends, so neither extreme. The
  // Stock view's margin grid shows the full range. The boom is not extended: no analyst lead years, growth capped as normal (or the 3-yr rate, max 15%, if analysts
  // do not forecast growth).
  var lastYear = prevNet.length ? prevNet[0] : null;
  var analystsSeeGrowth = consensus && estRev2 >= (rev || 0) * 0.95;
  var cycAvgNet = mean_([netMarginNow].concat(netFY).filter(function (x) { return x !== null; }));
  var peak = deepCyc && ovM === null && yoy !== null && yoy > 0.5 && netMarginNow !== null && cycAvgNet !== null &&
    netMarginNow > 0.15 && netMarginNow > 1.5 * Math.max(cycAvgNet, 0.02);
  out.cyclicalPeak = peak;
  var fcfBase = fcf, epsBase = eps;
  // One-off charges: TTM net margin below half its typical (median) level while operating cash flow is
  // positive. Earnings-based models then use typical-margin EPS instead of the depressed figure.
  var depressed = !peak && ovM === null && medNet !== null && medNet > 0.03 && netMarginNow !== null &&
    netMarginNow < 0.5 * medNet && ocf !== null && ocf > 0;
  out.depressedEarnings = depressed;
  if (depressed) {
    epsBase = rev * medNet / shares;
    out.notes.push('Earnings look depressed by one-off charges (TTM net margin ' + Math.round(netMarginNow * 100) +
      '% vs typical ' + Math.round(medNet * 100) + '%); earnings models use the typical margin');
  }
  if (trough) {
    var tNet = median_(prevNet);
    var tFcf = fcfFY.length ? median_(fcfFY) : null;
    mN = Math.max(mN, tNet); if (!(tFcf > 0)) tFcf = tNet; mF = Math.max(Math.min(mF, 0.6), tFcf);
    epsBase = rev * tNet / shares; fcfBase = rev * mF;
    out.notes.push('Cycle trough: losing money now but typically profitable (median net margin ' + Math.round(tNet * 100) + '%); valued on typical-cycle margins');
  }
  if (peak) {
    var cycFcf = mean_([fcfMarginNow].concat(fcfFY).filter(function (x) { return x !== null; }));
    var mid = function (now, avg) { return now === null ? avg : (now + avg) / 2; };
    mN = Math.max(mid(netMarginNow, cycAvgNet), 0.02);
    mF = Math.max(mid(fcfMarginNow, cycFcf !== null ? cycFcf : cycAvgNet), 0.02);
    fcfBase = rev * mF; epsBase = rev * mN / shares;
    // Revenue at a peak is inflated by boom prices, so growth on top of it is limited to 15% (analysts' forecasts
    // of further gains are mostly further price rises).
    if (ovG === null && gridG === null) {
      g0 = analystsSeeGrowth ? Math.min(g0, 0.15) : clamp_(cagr3 === null ? gT : cagr3, gT, 0.15);
      out.gBasis = 'Cyclical peak: growth from peak revenue limited to 15%';
    }
    lead = null; path = growthPath_(g0, gT); out.g0 = g0;
    out.notes.push('Cyclical peak: margins at ' + Math.round(netMarginNow * 100) + '% vs cycle average ' + Math.round(cycAvgNet * 100) +
      '%; valued on margins halfway between the two (' + Math.round(mN * 100) + '%). See the margin grid on Stock view');
  }
  // Margin scenario (sensitivity grid for deep cyclicals): scale long-run margins and the earnings/cash-flow base.
  var mScale = n_(ovr.marginScale);
  if (mScale !== null) {
    mN *= mScale; mF *= mScale; epsBase = epsBase === null ? null : epsBase * mScale;
    fcfBase = fcfBase === null ? (rev ? rev * mF : null) : fcfBase * mScale;
  }
  out.mN = mN;

  // Dilution (ignores share-count jumps that look like splits)
  var dil = null;
  if (shares1) { var ratio = shares / shares1; if (ratio > 0.6 && ratio < 1.6) dil = ratio - 1; }
  out.dilution = dil;
  // Projected dilution for the 5-year models. When stock pay is already subtracted from free cash flow, the
  // shares it creates (roughly stock pay / market value each year) are taken out, so the cost is not counted
  // twice; dilution from fund-raising and acquisitions, and shrinkage from buybacks, still count.
  var dilProj = dil;
  if (dil !== null && S.sbc && sbc) {
    var mcapNow = price && shares ? price * shares / (fx || 1) : null;
    dilProj = mcapNow > 0 ? dil - Math.abs(sbc) / mcapNow : Math.min(dil, 0);
    if (dil > 0 && dilProj < 0) dilProj = 0;   // stock pay explains all the dilution
  }
  var dilP = dilProj === null ? 0 : clamp_(dilProj, -0.05, 0.15);

  var allowed = MODELS_BY_TYPE[type];
  var M = {};
  var hasRev = rev !== null && rev >= 25e6;
  // Pre-revenue: start the revenue projection from analysts' forecast instead (speculative).
  var projRev = rev, projYears = 5;
  if (!hasRev && consensus && estRev2 >= 25e6) {
    projRev = estRev2; projYears = Math.max(1, Math.round(5 - yearsAhead)); hasRev = true;
    out.notes.push('Pre-revenue: valued from analysts\' revenue forecast');
  }
  // Exit multiples: high-return businesses (ROIC 20%+, not at a cyclical peak) may keep a higher multiple.
  var taxR = F('IncomeTax TTM') !== null && F('PretaxIncome TTM') ? clamp_(F('IncomeTax TTM') / F('PretaxIncome TTM'), 0, 0.35) : 0.21;
  var icE = (equity || 0) + debt - cash, opE = F('OperatingIncome TTM');
  var roicE = opE !== null && icE > 0 ? opE * (1 - taxR) / icE : null;
  // ...and a gross margin of 40%+, the mark of pricing power (a high ROIC alone can come from running on
  // suppliers' money, as in hardware distribution).
  var gmNowQ = F('GrossProfit TTM') !== null && rev ? F('GrossProfit TTM') / rev : null;
  var qualityMult = !peak && (type === 'Growth' || type === 'Mature') && roicE !== null && roicE >= 0.2 && gmNowQ !== null && gmNowQ >= 0.4;
  var peCapX = qualityMult ? S.peCap * 1.4 : S.peCap, pfCapX = qualityMult ? S.pfcfCap * 1.4 : S.pfcfCap;
  var peLater = exitMultiple_(avgRange(6, 10), peCapX);
  var pfLater = exitMultiple_(avgRange(6, 10), pfCapX);
  if (qualityMult && exitMultiple_(avgRange(6, 10), S.peCap) >= S.peCap) out.notes.push('High-return business (ROIC ' + Math.round(roicE * 100) + '%, gross margin ' + Math.round(gmNowQ * 100) + '%): exit P/E cap raised to ' + Math.round(peCapX));

  // DCF on cash flow to the whole business: free cash flow (after interest under US accounting) plus after-tax
  // interest, discounted at the blended cost of equity and debt (WACC); debt is then subtracted once, as net debt.
  var intPaid = F('InterestExpense TTM'), dcfCF = fcfBase, dcfR = r;
  if (fcfBase !== null && debt > 0 && intPaid && price && shares) {
    var eqV = price * shares / (fx || 1);
    // Cost of debt: today's borrowing cost, at least the AAA corporate bond yield (interest paid / debt reflects
    // older, cheaper loans). The blended rate never goes below the minimum discount rate.
    var rd = clamp_(Math.max(Math.abs(intPaid) / debt, S.aaa || 0.05), 0.03, 0.12);
    dcfCF = fcfBase + Math.abs(intPaid) * (1 - taxR);
    dcfR = Math.max((eqV * r + debt * rd * (1 - taxR)) / (eqV + debt), gT + 0.02, S.rMin);
    out.wacc = dcfR;
  }
  if (fcfBase !== null && fcfBase > 0 && type !== 'Financial') M['DCF'] = dcfPerShare_(dcfCF, g0, gT, dcfR, netCash, shares, lead);
  if (hasRev && type !== 'Financial') {
    M['FCF future market cap'] = projection5_(projRev, g0, gT, mF, pfLater, shares, dilP, S.req, projYears, lead).fv;
    var p5 = projection5_(projRev, g0, gT, mN, peLater, shares, dilP, S.req, projYears, lead);
    M['5-yr earnings'] = p5.fv;
    out.target5 = p5.target;
  }
  var useEstEps = consensus && !peak && estEps2 !== null && estEps2 > 0;
  if (useEstEps || (epsBase !== null && epsBase > 0)) {
    var eps2 = useEstEps ? estEps2 * fx * (mScale !== null ? mScale : 1) : epsBase * (1 + path[0]) * (1 + path[1]);
    if (useEstEps) out.notes.push('Fwd EPS x P/E uses consensus EPS (analysts often use adjusted EPS)');
    var epsYears = useEstEps ? yearsAhead : 2;
    // Financials: modest multiple (banks/insurers rarely sustain growth multiples); growth from revenue is unreliable for them.
    var fwdPE = type === 'Financial' ? clamp_(8.5 + 2 * Math.min(avgRange(3, 7), gT) * 100, 8, Math.min(S.peCap, 14.5)) : exitMultiple_(avgRange(3, 7), peCapX);
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
      sol = solveGrowth_(function (g) { return dcfPerShare_(dcfCF, g, gT, dcfR, netCash, shares); }, price);
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
  // Next year is "abnormal" when its EPS is far below (one-off charges) or far above (one-off gains) the
  // last reported annual EPS AND the year after reverts. Fast genuine growth is not abnormal.
  var epsFY0 = n_(raw['EPS FY0']);
  var abnormal = estEps1 !== null && estEps2 !== null && estEps2 > 0 && epsFY0 !== null && epsFY0 > 0 &&
    ((estEps1 < 0.6 * epsFY0 && estEps2 / Math.max(estEps1, 0.01) > 1.5) || (estEps1 > 1.6 * epsFY0 && estEps2 / estEps1 < 0.67));
  if (estEps1 !== null && estEps1 > 0 && estEps2 !== null && estEps2 > 0 && !abnormal) {
    out.pegEps = estEps1 * fx; out.epsGrowth = estEps2 / estEps1 - 1; out.epsGrowthBasis = 'Forward: consensus EPS next year to year after';
  } else if (abnormal) {
    out.pegEps = estEps2 * fx; out.epsGrowth = g0;
    out.epsGrowthBasis = 'Next year looks abnormal (EPS ' + (estEps1 * fx).toFixed(2) + ' then ' + (estEps2 * fx).toFixed(2) + '): year-after EPS and start growth used';
  } else {
    out.pegEps = eps; out.epsGrowth = g0; out.epsGrowthBasis = 'Trailing EPS, start growth rate';
  }
  // Comparable expected growth: the start growth (on the standard fade, as implied growth uses) that gives the
  // same DCF value as the model's own path. Differs from g0 only when analysts' 2-year forecasts lead the path.
  out.gComparable = g0;
  if (lead && fcfBase !== null && fcfBase > 0 && type !== 'Financial') {
    var target = dcfPerShare_(dcfCF, g0, gT, dcfR, netCash, shares, lead);
    var eq = solveGrowth_(function (g) { return dcfPerShare_(dcfCF, g, gT, dcfR, netCash, shares); }, target);
    if (eq.g !== null) out.gComparable = eq.g;
  } else if (lead) out.gComparable = lead.g;
  out.expGap = typeof out.implied === 'number' ? out.implied - out.gComparable : null;
  out.modelVsAnalysts = out.fv && out.analystTarget ? out.fv / out.analystTarget - 1 : null;

  // Metrics
  out.divYield = price && div ? div / (price * shares) : 0;
  out.grossMargin = F('GrossProfit TTM') !== null && rev ? F('GrossProfit TTM') / rev : null;
  out.opMargin = F('OperatingIncome TTM') !== null && rev ? F('OperatingIncome TTM') / rev : null;
  out.fcfMargin = fcfMarginNow;
  out.fcfCashMargin = ocf !== null && rev ? (ocf - capex) / rev : null;   // actual cash, before any stock-pay deduction
  out.netCash = netCash;
  out.pe = price && eps > 0 ? price / eps : null;
  out.evSales = price && rev ? (price * shares - netCash) / rev : null;
  out.runway = fcf !== null && fcf < 0 ? cash / -fcf * 12 : null;
  var opInc = F('OperatingIncome TTM'), tax = F('IncomeTax TTM'), pre = F('PretaxIncome TTM');
  var tr = tax !== null && pre ? clamp_(tax / pre, 0, 0.35) : 0.21;
  var ic = (equity || 0) + debt - cash;
  out.roic = opInc !== null && ic > 0 ? opInc * (1 - tr) / ic : null;
  // Debt safety (not meaningful for banks and insurers, whose borrowing is their raw material)
  var da = F('DA TTM'), intExp = F('InterestExpense TTM');
  // EBITDA: operating profit + depreciation & amortisation, cross-checked against operating cash flow + interest
  // (filers often split or omit amortisation); the higher of the two is used.
  var ebitda = opInc === null ? null : opInc + (da !== null ? Math.abs(da) : 0);
  var ebitdaCF = ocf !== null ? ocf + (intExp ? Math.abs(intExp) : 0) : null;
  if (ebitdaCF !== null && (ebitda === null || ebitdaCF > ebitda)) ebitda = ebitdaCF;
  var netDebt = debt - cash;
  out.ndEbitda = type === 'Financial' || ebitda === null ? null : netDebt <= 0 ? 0 : ebitda > 0 ? netDebt / ebitda : null;
  // Interest cover on EBITDA, so amortisation of acquired intangibles does not make acquirers look distressed.
  out.intCover = type === 'Financial' || ebitda === null || !intExp ? null : ebitda / Math.abs(intExp);
  var utility = sic >= 4900 && sic <= 4999;   // regulated utilities normally carry more debt
  out.highDebt = type !== 'Financial' && netDebt > 0 && ((out.ndEbitda !== null && out.ndEbitda > (utility ? 6 : 3.5)) ||
    (out.intCover !== null && out.intCover < 3) || (ebitda !== null && ebitda <= 0));
  if (out.highDebt) out.notes.push('High debt: ' + (out.ndEbitda !== null ? 'net debt ' + out.ndEbitda.toFixed(1) + 'x EBITDA' : 'net debt with no operating profit') +
    (out.intCover !== null ? ', interest cover ' + out.intCover.toFixed(1) + 'x' : ''));

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
  setupFor_(out, raw, price, eps, type, S);
  return out;
}

/* Setup: where value, analysts, estimate revisions, quality and price trend agree.
   Value setup  - at or below fair value, analysts see 15%+ upside, estimates not falling, trend not broken.
   Compounder   - looks expensive, but the price assumes less growth than the company delivers,
                  with high returns on capital, rising estimates and a rising price.
   Quality pullback - quality business, analysts raising estimates, but the price has fallen below its 200-day average.
   Value, estimates falling - cheap, but analysts are cutting forecasts (the classic value-trap pattern).
   Trend broken - a quality grower that is not cheap, with the price falling and estimates no longer rising.
   Thin targets - big analyst upside resting on few analysts or a very wide range of targets. */
var SETUP_RANK = { 'Value setup': 1, 'Compounder': 2, 'Quality pullback': 3, 'Value, estimates falling': 4, 'Trend broken': 5, 'High debt': 6, 'Thin targets': 7, 'Cash burner': 8 };
function setupFor_(out, raw, price, eps, type, S) {
  out.setup = ''; out.setupScore = null; out.setupChecks = ''; out.setupRank = '';
  // Veto: burning cash AND priced far above fundamentals (over 3x fair value, or over 15x sales).
  // In the 2023-26 back-test on your own trades, almost none of these beat the index.
  // Uses actual cash flow (before deducting stock pay), as in the back-test that supports this rule.
  var cashM = out.fcfCashMargin !== null && out.fcfCashMargin !== undefined ? out.fcfCashMargin : out.fcfMargin;
  if (price && cashM !== null && cashM !== undefined && cashM < 0 &&
      (!out.fv || price > 3 * out.fv || (out.evSales !== null && out.evSales !== undefined && out.evSales > 15))) {
    out.setup = 'Cash burner'; out.setupRank = SETUP_RANK['Cash burner']; out.setupScore = 0;
    out.setupChecks = 'Negative free cash flow' + (out.fv ? ', price ' + (price / out.fv).toFixed(1) + 'x fair value' : ', no fair value from fundamentals') +
      (out.evSales > 15 ? ', ' + Math.round(out.evSales) + 'x sales' : '') + '. Avoid unless you have a strong, specific reason.';
    return;
  }
  if (!price || !out.fv) return;
  var exp = Math.pow(out.fv / price, 1 / 5) * (1 + S.req) - 1;
  var tUp = out.analystTarget ? out.analystTarget / price - 1 : null;
  var hi = n_(raw['Target high']), lo = n_(raw['Target low']);
  var thin = !out.analysts || out.analysts < 5 || (out.analysts < 10 && hi > 0 && lo > 0 && hi / lo > 3);
  var up30 = n_(raw['Revisions up 30d']), dn30 = n_(raw['Revisions down 30d']);
  var e90 = out.estChg90;
  var estUp = e90 !== null ? e90 > 0.005 : up30 !== null && dn30 !== null && up30 > dn30;
  var estDown = e90 !== null ? e90 < -0.01 : up30 !== null && dn30 !== null && dn30 > up30;
  var v2 = out.vs200, m12 = out.mom12;
  var trendUp = v2 === null ? null : v2 > 0 && (m12 === null || m12 > -0.05);
  var trendDown = v2 !== null && v2 < -0.05;
  var profitable = eps > 0 && (type === 'Financial' || (out.opMargin !== null && out.opMargin > 0));
  var spec = type === 'Pre-profit' || !profitable || out.notes.some(function (x) { return /Caution|Speculative/.test(x); });
  var growth = Math.max(out.revYoY === null || out.revYoY === undefined ? -1 : out.revYoY, out.epsGrowth === null || out.epsGrowth === undefined ? -1 : out.epsGrowth);
  var impl = typeof out.implied === 'number' ? out.implied : null;
  var pricedIn = impl !== null && growth > 0 && impl <= growth;
  var cheap = exp >= S.req;                          // price at or below fair value
  var dir = out.scorePct || 0, roic = out.roic;
  var analystsAgree = tUp !== null && tUp >= 0.15 && !thin;

  var s = '';
  var debtOK = !out.highDebt;
  if (!debtOK && !spec) s = 'High debt';
  // Long-term investing: a falling price does not block a setup (the best prices are often below trend);
  // falling analyst forecasts do.
  else if (!spec && cheap && analystsAgree && !estDown && dir >= 0.6) s = 'Value setup';
  else if (!spec && !cheap && roic !== null && roic >= 0.12 && dir >= 0.75 && growth >= 0.12 && pricedIn && estUp &&
    trendUp !== false && (tUp === null || tUp > 0)) s = 'Compounder';
  else if (!spec && trendDown && !estDown && dir >= 0.6 && roic !== null && roic >= 0.12 && analystsAgree && pricedIn) s = 'Quality pullback';
  else if (!spec && cheap && dir >= 0.5 && estDown) s = 'Value, estimates falling';
  else if (!spec && !cheap && roic !== null && roic >= 0.12 && growth >= 0.1 && !estUp && (trendDown || (v2 !== null && v2 < -0.15))) s = 'Trend broken';
  else if (tUp !== null && tUp >= 0.3 && thin) s = 'Thin targets';
  out.setup = s; out.setupRank = s ? SETUP_RANK[s] : '';
  out.trendUp = trendUp; out.expRet = exp; out.speculative = spec; out.thinTargets = thin;
  var tick = function (b) { return b === null ? '–' : b ? '✓' : '✗'; };
  out.setupScore = [cheap, analystsAgree, estUp, dir >= 0.75, trendUp === true, roic !== null && roic >= 0.15, pricedIn && !out.highDebt]
    .filter(function (b) { return b; }).length;
  out.setupChecks = 'Value ' + tick(cheap) + '  Analysts ' + (tUp === null ? '–' : thin ? '? (thin)' : tick(analystsAgree)) +
    '  Estimates ' + (estUp ? '↑' : estDown ? '↓' : '–') + '  Quality ' + tick(roic === null ? null : roic >= 0.15 && dir >= 0.6) +
    '  Trend ' + (trendUp === null ? '–' : trendUp ? '↑' : trendDown ? '↓' : '→') + '  Priced-in growth ' + tick(impl === null ? null : pricedIn) +
    '  Debt ' + (out.highDebt ? '✗' : out.ndEbitda === null && out.intCover === null ? '–' : '✓') +
    (spec ? '  (speculative: no setup)' : '');
}

/* ======================================================================== */
/*  STAGE 2 — SHEET WIRING: Calc, Watchlist, History, FX, rates             */
/* ======================================================================== */

var SHEET2 = { CALC: 'Calc', WATCH: 'Watchlist', HIST: 'History', FX: 'FX', SETUPS: 'Setups' };

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
  ['Implied growth (reverse DCF)', '0.0%', 'implied'], ['Start growth', '0.0%', 'g0'], ['Expected growth (comparable)', '0.0%', 'gComparable'], ['Growth basis', '@', 'gBasis'],
  ['Discount rate', '0.0%', 'r'],
  ['DCF', '#,##0.00', 'm:DCF'], ['FCF future market cap', '#,##0.00', 'm:FCF future market cap'],
  ['5-yr earnings', '#,##0.00', 'm:5-yr earnings'], ['Fwd EPS x P/E', '#,##0.00', 'm:Fwd EPS x P/E'],
  ['Graham', '#,##0.00', 'm:Graham'], ['Lynch', '#,##0.00', 'm:Lynch'], ['Dividend discount', '#,##0.00', 'm:Dividend discount'],
  ['Justified P/B', '#,##0.00', 'm:Justified P/B'],
  ['5-yr price (earnings model)', '#,##0.00', 'target5'], ['Dividend yield', '0.0%', 'divYield'],
  ['Revenue growth 1-yr', '0.0%;[Red]-0.0%', 'revYoY'], ['Revenue growth 3-yr CAGR', '0.0%;[Red]-0.0%', 'revCagr3'],
  ['Gross margin', '0.0%;[Red]-0.0%', 'grossMargin'], ['Operating margin', '0.0%;[Red]-0.0%', 'opMargin'],
  ['FCF margin', '0.0%;[Red]-0.0%', 'fcfMargin'], ['ROIC', '0.0%;[Red]-0.0%', 'roic'],
  ['Net cash (m)', '#,##0;[Red]-#,##0', 'netCashM'], ['Net debt / EBITDA', '0.0"x"', 'ndEbitda'], ['Interest cover', '0.0"x"', 'intCover'], ['EV / sales', '0.0', 'evSales'], ['P/E (TTM)', '0.0', 'pe'],
  ['Cash runway (months)', '0', 'runway'], ['Dilution 1-yr', '0.0%;[Red]-0.0%', 'dilution'],
  ['Data as of', '@', 'dataDate'], ['Notes', '@', 'notesText'],
  ['Analyst target', '#,##0.00', 'analystTarget'], ['Analyst target upside', '0.0%;[Red]-0.0%', 'F:tupside'],
  ['Analysts', '0', 'analysts'],
  ['EPS for PEG', '#,##0.00', 'pegEps'], ['Expected EPS growth', '0.0%;[Red]-0.0%', 'epsGrowth'], ['PEG basis', '@', 'epsGrowthBasis'],
  ['PEG', '0.00', 'F:peg'], ['Expectations gap (implied - expected growth)', '+0.0%;[Red]-0.0%', 'expGap'],
  ['Model vs analysts', '+0%;[Red]-0%', 'modelVsAnalysts'],
  ['Next earnings', '@', 'nextEarnings'], ['Last EPS surprise', '+0.0%;[Red]-0.0%', 'surprise'],
  ['EPS estimate change 30d', '+0.0%;[Red]-0.0%', 'estChg30'], ['EPS estimate change 90d', '+0.0%;[Red]-0.0%', 'estChg90'],
  ['Analyst revisions 30d', '@', 'revisionsText'],
  ['Setup', '@', 'setup'], ['Setup strength (of 7)', '0', 'setupScore'], ['Setup checks', '@', 'setupChecks'], ['Setup rank', '0', 'setupRank'],
  ['Action', '@', 'action'], ['Target weight', '0.0%', 'targetW'], ['Weight now', '0.0%', 'weightNow'], ['Order (£)', '£#,##0;[Red]-£#,##0', 'orderGBP'],
  ['Action reason', '@', 'actionWhy'],
  ['12m price change', '+0%;[Red]-0%', 'mom12'], ['Price vs 200-day average', '+0%;[Red]-0%', 'vs200'],
  ['Sort key', '0.000', 'F:sort']
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
      // Annual return if the price moves to fair value over 5 years while the business earns the required return.
      return '=IF(OR(' + G + '="",' + P + '="",N(' + P + ')<=0,N(' + G + ')<=0),"",(' + G + '/' + P + ')^(1/5)*(1+REQ_RETURN)-1)';
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
      shares: typeof r[6] === 'number' ? r[6] : null, beta: typeof r[7] === 'number' ? r[7] : null,
      mcap: typeof r[5] === 'number' ? r[5] : null };
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
  // Alphabetical, so the Stock view dropdown (which lists Calc tickers) is easy to search.
  out.sort(function (a, b) { return a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0; });
  var orders = [];
  try { orders = planPortfolio_(out, market, S, tv); } catch (e) { log_('', 'Portfolio rules: ' + e.message); }
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
  try { writeOrders_(orders); } catch (e) { log_('', 'Orders tab: ' + e.message); }

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

/** History: weekly snapshot per ticker. Setup and analyst columns let the setups be tested later on real outcomes. */
var HIST_COLS = ['Date', 'Ticker', 'Price', 'Fair value', 'Direction score', 'Setup', 'Setup strength', 'Analyst target',
  'Analysts', 'EPS estimate change 90d', 'Price vs 200-day average', 'Free cash flow margin'];
function historyIndex_(today) {
  var sh = ensureSheet_(SHEET2.HIST, HIST_COLS);
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
  var add = rows.filter(function (v) { return v.fv || v.setup; }).map(function (v) {
    var x = function (k) { return v[k] === undefined || v[k] === null || (typeof v[k] === 'number' && !isFinite(v[k])) ? '' : v[k]; };
    return [now, v.ticker, typeof mk[v.ticker] === 'number' ? mk[v.ticker] : '', v.fv, x('score'), x('setup'), x('setupScore'),
      x('analystTarget'), x('analysts'), x('estChg90'), x('vs200'), x('fcfMargin')];
  });
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, HIST_COLS.length).setValues(add);
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
  nameSetting_('Required return (5-year models)', 'REQ_RETURN');
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
  ['EPS est. change 90d', 'EPS estimate change 90d', '+0.0%;[Red]-0.0%', 80], ['Revisions 30d', 'Analyst revisions 30d', '@', 100],
  ['Setup', 'Setup', '@', 150], ['Setup checks', 'Setup checks', '@', 420],
  ['Net debt / EBITDA', 'Net debt / EBITDA', '0.0"x"', 80], ['Interest cover', 'Interest cover', '0.0"x"', 75],
  ['Action', 'Action', '@', 70], ['Target weight', 'Target weight', '0.0%', 75], ['Order (£)', 'Order (£)', '£#,##0;[Red]-£#,##0', 80],
  ['Action reason', 'Action reason', '@', 380]
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
  ['Signal', 'Watch signal', '@'], ['Setup', 'Setup', '@'], ['Action', 'Action', '@'], ['Target weight', 'Target weight', '0.0%'], ['Implied growth', 'Implied growth (reverse DCF)', '0.0%'],
  ['Cash runway (months)', 'Cash runway (months)', '0'], ['Dilution 1-yr', 'Dilution 1-yr', '0.0%;[Red]-0.0%'],
  ['Net debt / EBITDA', 'Net debt / EBITDA', '0.0"x"'], ['Interest cover', 'Interest cover', '0.0"x"'],
  ['Analyst target', 'Analyst target', '#,##0.00'], ['PEG', 'PEG', '0.00'],
  ['Expectations gap', 'Expectations gap (implied - expected growth)', '+0.0%;[Red]-0.0%'],
  ['Model vs analysts', 'Model vs analysts', '+0%;[Red]-0%'],
  ['Next earnings', 'Next earnings', '@'], ['Last EPS surprise', 'Last EPS surprise', '+0.0%;[Red]-0.0%'],
  ['EPS est. change 90d', 'EPS estimate change 90d', '+0.0%;[Red]-0.0%'], ['Revisions 30d', 'Analyst revisions 30d', '@'],
  ['Price vs 200-day avg', 'Price vs 200-day average', '+0%;[Red]-0%'], ['Setup checks', 'Setup checks', '@'],
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

/** Setups tab: holdings and watchlist stocks where several signals agree, strongest first. */
var SETUP_COLS = [
  ['Setup', 'Setup', '@', 170], ['Ticker', 'Ticker', '@', 70], ['Name', 'Name', '@', 190], ['List', 'List', '@', 80],
  ['Sector', 'Sector', '@', 130], ['Price', 'Price', '#,##0.00', 75], ['Fair value', 'Fair value', '#,##0.00', 75],
  ['Exp. return a year (5 yrs)', 'Exp. 5-yr return (a year)', '0.0%;[Red]-0.0%', 85],
  ['Analyst target upside', 'Analyst target upside', '+0%;[Red]-0%', 80], ['Analysts', 'Analysts', '0', 65],
  ['Direction', 'Direction', '@', 70], ['Implied growth', 'Implied growth (reverse DCF)', '0.0%', 80],
  ['Revenue growth 1-yr', 'Revenue growth 1-yr', '0.0%;[Red]-0.0%', 80], ['ROIC', 'ROIC', '0.0%;[Red]-0.0%', 70],
  ['EPS est. change 90d', 'EPS estimate change 90d', '+0.0%;[Red]-0.0%', 80], ['12m price change', '12m price change', '+0%;[Red]-0%', 80],
  ['Price vs 200-day avg', 'Price vs 200-day average', '+0%;[Red]-0%', 80], ['Strength (of 7)', 'Setup strength (of 7)', '0', 70],
  ['Checks', 'Setup checks', '@', 470]
];
var SETUP_HELP = [
  ['What the setups mean', ''],
  ['Value setup', 'At or below fair value, analysts see 15%+ upside (5+ analysts), estimates not being cut, Direction 60%+. A falling price does not block it: for long-term investors the best prices are often below trend.'],
  ['Compounder', 'Looks expensive on fair value, but the price assumes less growth (Implied growth) than the company is delivering. ROIC 12%+, Direction 75%+, estimates rising, price above its 200-day average.'],
  ['Quality pullback', 'Above fair value, but priced for less growth than it delivers. ROIC 12%+, estimates not being cut, analysts see 15%+ upside, and the price is 5%+ below its 200-day average. Often the chance to buy a strong performer on a dip.'],
  ['Value, estimates falling', 'Cheap, but analysts are cutting forecasts. The classic value-trap pattern: wait for forecasts to stop falling.'],
  ['Trend broken', 'A quality grower, not cheap, with the price 5%+ below its 200-day average and estimates no longer rising. For holdings: time to review or trim.'],
  ['High debt', 'Net debt over 3.5x EBITDA (6x for utilities), EBITDA under 3x interest, or net debt with no operating profit. Blocks the buy-type setups. Banks and insurers are excluded.'],
  ['Cash burner', 'Veto: negative free cash flow and priced over 3x fair value or 15x sales. In a back-test on your 2023-26 trades, almost none of these beat the S&P 500.'],
  ['Thin targets', 'Analyst upside of 30%+ resting on fewer than 5 analysts, or fewer than 10 with the highest target over 3x the lowest. Treat the target with caution.'],
  ['', ''],
  ['Strength (of 7)', 'One point each: at/below fair value, analysts agree, estimates rising, Direction 75%+, price uptrend, ROIC 15%+, priced-in growth below actual growth (and debt not high).'],
  ['Not a buy list', 'Setups are a shortlist to research. Loss-making and speculative stocks never qualify (except Thin targets).']
];
function writeSetups_(formulasOnly) {
  var ss = SpreadsheetApp.getActive();
  var isNew = !ss.getSheetByName(SHEET2.SETUPS);
  var heads = SETUP_COLS.map(function (c) { return c[0]; });
  var sh = ensureSheet_(SHEET2.SETUPS, heads);
  sh.getRange(1, 1, 1, heads.length).setFontColor('#FFFFFF').setBackground('#1F3A5F').setWrap(true);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getMaxRows() - 1, heads.length).clearContent();
  var col = function (h) { return 'Calc!' + calcL_(h) + '2:' + calcL_(h); };
  var arr = '{' + SETUP_COLS.map(function (c) { return col(c[1]); }).join(',') + '}';
  var cond = col('Setup') + '<>""';
  sh.getRange('A2').setFormula('=IFERROR(SORT(FILTER(' + arr + ',' + cond + '),FILTER(' + col('Setup rank') + ',' + cond + '),TRUE,FILTER(' +
    col('Setup strength (of 7)') + ',' + cond + '),FALSE),"No setups yet: run Valuation ▸ Recalculate valuations")');
  SETUP_COLS.forEach(function (c, i) { sh.getRange(2, i + 1, 499, 1).setNumberFormat(c[2]); });
  if (formulasOnly) return;
  SETUP_COLS.forEach(function (c, i) { sh.setColumnWidth(i + 1, c[3]); });
  sh.setFrozenColumns(2);
  var hc = heads.length + 2;
  if (sh.getMaxColumns() < hc + 1) sh.insertColumnsAfter(sh.getMaxColumns(), hc + 1 - sh.getMaxColumns());
  sh.getRange(1, hc, SETUP_HELP.length, 2).setValues(SETUP_HELP).setWrap(true);
  sh.getRange(1, hc, 1, 2).setFontWeight('bold');
  sh.getRange(2, hc, SETUP_HELP.length - 1, 1).setFontWeight('bold');
  sh.setColumnWidth(hc, 170); sh.setColumnWidth(hc + 1, 420);
  if (isNew) {
    try {
      var w = ss.getSheetByName(SHEET2.WATCH);
      if (w && ss.moveActiveSheet) { ss.setActiveSheet(sh); ss.moveActiveSheet(w.getIndex() + 1); }
    } catch (e) { /* tab order is cosmetic */ }
  }
}


/* ======================================================================== */
/*  PORTFOLIO RULES: mechanical buy / add / hold / trim / sell               */
/* ======================================================================== */
/* Every stock gets an Action and a target weight from the rules below; the Orders tab lists the trades
   that follow, sized in pounds. Tick an order Done when you have placed it: it is logged, Holdings and
   Cash available are updated, and the next run carries on from there.

   Buy-type setups (Value setup, Compounder, Quality pullback) qualify when Direction >= 75%, Strength >= 5
   (a missing Trend point is not held against it) and the price needs no more growth than expected.
   Target = best-ideas cap x (40% + 60% x conviction); conviction blends Strength, expected return, the
   expectations cushion and Direction. Cyclicals are capped lower. Below the 200-day average a position is
   built in thirds, at least N days apart (or sooner on a further 10% fall); above it, in one go.
   Holdings with a warning are halved, then sold if the warning lasts N weekly snapshots. Stretched holdings
   that no longer qualify, and anything over the hard cap, are trimmed to target. Unqualified and
   speculative holdings are held without adding, and trimmed back if above 1.5x the speculative cap.
   New money only goes to qualifying stocks, best first; what is left stays in cash. */
var ORDERS = { NAME: 'Orders', LOG: 'Order log', RULES: 'Rules' };
var WARN_SETUPS = { 'Value, estimates falling': 1, 'Trend broken': 1, 'High debt': 1, 'Cash burner': 1 };

function portfolioSettings_() {
  var m = assumptionsMap_();
  var g = function (label) {
    var row = SETTINGS.filter(function (r) { return r[0] === label; })[0];
    var v = m[label];
    return v === '' || v === undefined || v === null ? (row ? row[1] : null) : Number(v);
  };
  return { cash: g('Cash available (£)') || 0, reserve: g('Cash reserve'), maxBest: g('Max position (best ideas)'),
    maxCyc: g('Max position (cyclical)'), maxSpec: g('Max position (speculative)'), maxInd: g('Max per industry'),
    hardCap: g('Trim if any position above'), minPos: g('Min position'), minOrder: g('Minimum order (£)'), addDays: g('Days between adds'),
    warnWeeks: g('Weeks of warnings before selling'), pace: g('Max new money per week'), newPerWeek: g('Max new positions per week'), stretch: num0_(m['Stretched if 5-yr expected return below'], 0.06) };
}
function num0_(v, d) { return v === '' || v === undefined || v === null || isNaN(Number(v)) ? d : Number(v); }

/** Price of one share in pounds. */
function toGBP_(price, ccy, fxUsd, fx) {
  if (!(price > 0)) return null;
  if (ccy === 'GBX') return price / 100;
  if (ccy === 'GBP' || !ccy) return price;
  if (ccy === 'USD') return fxUsd ? price * fxUsd : null;
  return fx[ccy + 'GBP'] ? price * fx[ccy + 'GBP'] : null;
}

function planPortfolio_(out, market, S, tv) {
  var ss = SpreadsheetApp.getActive(), P = portfolioSettings_();
  var fxR = ss.getRangeByName('FX_USDGBP'), fxUsd = fxR ? Number(fxR.getValue()) || null : null;
  var ccys = {};
  out.forEach(function (v) { var c = (market[v.ticker] || {}).currency; if (c && ['GBX', 'GBP', 'USD'].indexOf(c) < 0) ccys[c + 'GBP'] = 1; });
  var fx = fxRates_(Object.keys(ccys));
  // Holdings: ticker -> shares, value in pounds
  var hs = ss.getSheetByName(SHEET.HOLDINGS), hold = {};
  if (hs.getLastRow() > 1) hs.getRange(2, 1, hs.getLastRow() - 1, 10).getValues().forEach(function (r) {
    var t = String(r[0]).trim().toUpperCase(); if (!t) return;
    hold[t] = { shares: Number(r[3]) || 0, value: typeof r[9] === 'number' ? r[9] : 0 };
  });
  var invested = Object.keys(hold).reduce(function (a, t) { return a + hold[t].value; }, 0);
  var total = invested + P.cash;
  if (!(total > 0)) return [];
  // Warning streaks (weekly History snapshots) and the order log
  var warnWeeks = warningStreaks_(), log = orderLogIndex_();
  var byInd = {};
  out.forEach(function (v) {
    var m = market[v.ticker] || {};
    v.priceGBP = toGBP_(m.price, m.currency, fxUsd, fx); v.localPrice = m.price; v.localCcy = m.currency || '';
    var h = hold[v.ticker]; v.valueNow = h ? h.value : 0; v.weightNow = v.valueNow / total;
    var ind = v.industry || v.sector || 'Other'; byInd[ind] = (byInd[ind] || 0) + v.weightNow; v.indKey = ind;
  });
  var clip = function (x) { return Math.max(0, Math.min(1, x)); };
  // Pass 1: which stocks qualify, and their stand-alone targets.
  var isBuyType = function (v) { return v.setup === 'Value setup' || v.setup === 'Compounder' || v.setup === 'Quality pullback'; };
  var sumQ = 0, heldOther = 0;
  out.forEach(function (v) {
    var sAdj = (v.setupScore || 0) + (v.trendUp === true ? 0 : 1);
    var gp = typeof v.expGap === 'number' ? v.expGap : null;
    v._q = isBuyType(v) && (v.scorePct || 0) >= 0.75 && sAdj >= 5 && (gp === null || gp <= 0.02);
    if (v._q) {
      var cv = (clip((sAdj - 5) / 2) + clip(((v.expRet || 0.1) - 0.10) / 0.15) + clip(-(gp || 0) / 0.3) + clip(((v.scorePct || 0) - 0.75) / 0.25)) / 4;
      v._t = (v.deepCyclical ? P.maxCyc : P.maxBest) * (0.4 + 0.6 * cv);
      sumQ += v._t;
    } else if (v.valueNow > 0) heldOther += v.weightNow;
  });
  // Targets must fit in the portfolio: what is left after the cash reserve and the holdings that do not
  // qualify is shared among qualifying stocks in proportion to conviction (best ideas still get the most).
  var room = Math.max(0, 1 - P.reserve - heldOther);
  // Keep only as many qualifiers (strongest first) as fit at the minimum position size or more.
  var Q = out.filter(function (v) { return v._q; }).sort(function (a, b) { return b._t - a._t; });
  var scale = 1;
  while (Q.length) {
    var sum = Q.reduce(function (a, v) { return a + v._t; }, 0);
    scale = sum > room ? room / sum : 1;
    if (Q.length === 1 || Q[Q.length - 1]._t * scale >= P.minPos) break;
    var drop = Q.pop(); drop._q = false; drop._ranked = Q.length;
  }
  if (!Q.length) scale = 0;
  var orders = [], sells = 0;
  out.forEach(function (v) {
    v.action = ''; v.targetW = ''; v.orderGBP = ''; v.actionWhy = '';
    var held = v.valueNow > 0;
    var buyType = v.setup === 'Value setup' || v.setup === 'Compounder' || v.setup === 'Quality pullback';
    var strengthAdj = (v.setupScore || 0) + (v.trendUp === true ? 0 : 1);
    var gap = typeof v.expGap === 'number' ? v.expGap : null;
    var qualifies = v._q;
    var warned = !!WARN_SETUPS[v.setup];
    var why = [];
    if (qualifies) {
      v.targetW = v._t * scale;
      why.push(v.setup + ', strength ' + v.setupScore + '/7, direction ' + Math.round((v.scorePct || 0) * 100) + '%');
    } else if (held) {
      v.targetW = v.speculative || v.thinTargets || v.type === 'Pre-profit' ? Math.min(v.weightNow, P.maxSpec) : v.weightNow;
    }
    if (!v.priceGBP) { v.action = held ? 'Hold' : ''; if (held) v.actionWhy = 'No price in pounds yet'; return; }
    // --- sells and trims (holdings) ---
    if (held) {
      var streak = warnWeeks[v.ticker] || 0, trimmedSince = log.lastTrimAfter(v.ticker, streak);
      var amt = 0;
      if (warned) {
        if (streak >= P.warnWeeks) { amt = v.valueNow; v.action = 'Sell'; why.push(v.setup, 'warning for ' + streak + ' weeks'); }
        else if (!trimmedSince) { amt = v.valueNow / 2; v.action = 'Trim'; why.push(v.setup, 'first warning: halve'); }
        else { v.action = 'Hold'; why.push('Warning (' + v.setup + '), already halved; sell if it lasts ' + P.warnWeeks + ' weeks'); }
        v.targetW = amt === v.valueNow ? 0 : (v.valueNow - amt) / total;
      } else if (v.weightNow > P.hardCap) {
        var tgt = qualifies ? Math.min(v.targetW, P.hardCap) : P.maxBest;
        amt = v.valueNow - tgt * total; v.action = 'Trim'; why.push('Over ' + Math.round(P.hardCap * 100) + '% of the portfolio');
      } else if (!qualifies && !buyType && (v.scorePct || 0) < 0.75 && typeof v.expRet === 'number' && v.expRet < P.stretch && v.weightNow > P.maxSpec) {
        amt = v.valueNow / 3; v.action = 'Trim'; why.push('Stretched (expected return ' + Math.round(v.expRet * 100) + '% a year), no buy setup and business not improving strongly: trim a third');
        v.targetW = (v.valueNow - amt) / total;
      } else if (!qualifies && (v.speculative || v.thinTargets || v.type === 'Pre-profit') && v.weightNow > 1.5 * P.maxSpec) {
        amt = v.valueNow - P.maxSpec * total; v.action = 'Trim'; why.push('Speculative: trim to ' + (P.maxSpec * 100).toFixed(1) + '% cap');
        v.targetW = P.maxSpec;
      }
      if (amt >= P.minOrder) {
        orders.push({ action: v.action, v: v, gbp: -amt, why: why.join('; ') });
        sells += amt; v.orderGBP = -amt; v.actionWhy = why.join('; ');
        byInd[v.indKey] -= amt / total;
        return;
      }
      if (v.action === 'Trim' || v.action === 'Sell') v.action = 'Hold';
    }
    // --- buys and adds ---
    if (qualifies && v.targetW > v.weightNow) {
      var gapW = v.targetW - v.weightNow, tranche = v.targetW / 3;
      var last = log.lastBuy(v.ticker);
      var stepOK = v.trendUp === true || !last || last.days >= P.addDays || (v.localPrice && last.price && v.localPrice <= last.price * 0.9);
      if (!stepOK) { v.action = held ? 'Hold' : 'Wait'; v.actionWhy = 'Next third due ' + (P.addDays - last.days) + ' days after last buy (or on a 10% fall)'; return; }
      var w = v.trendUp === true ? gapW : Math.min(gapW, tranche);
      v.action = held ? 'Add' : 'Buy';
      v.pendingW = w; v.priority = v.targetW;
      v.actionWhy = why.concat(v.trendUp === true ? ['above 200-day average: full position'] : ['below 200-day average: building in thirds']).join('; ');
      return;
    }
    if (v._ranked !== undefined) { v.action = held ? 'Hold' : 'Wait'; v.actionWhy = 'Qualifies, but ranks below the ' + v._ranked + ' strongest that fit the portfolio at ' + Math.round(P.minPos * 100) + '%+ each'; return; }
    if (held && !v.action) { v.action = 'Hold'; v.actionWhy = qualifies ? 'At target' : (v.setup ? v.setup + ': no adds' : 'Does not qualify for adds'); }
    else if (!held && buyType && !qualifies) { v.action = 'Watch'; v.actionWhy = 'Setup but not all rules: ' + [(v.scorePct || 0) < 0.75 ? 'direction under 75%' : '', strengthAdj < 5 ? 'strength under 5' : '', gap !== null && gap > 0.02 ? 'priced for more growth than expected' : ''].filter(String).join(', '); }
  });
  // Allocate cash to buys, strongest first, within the reserve and industry caps.
  // Only cash already in the account is spent: money from trims and sales counts once they are ticked Done
  // (which adds it to Cash available and recalculates).
  var budget = P.cash - P.reserve * total;
  // Pace: spread new money over weeks. The weekly allowance is a share of the cash held at the start of the
  // 7-day window (cash now + what was spent in it), less what was already spent; sale proceeds are added on top.
  var wk = log.weekBuys(), paceNote = '';
  if (P.pace !== null && P.pace < 1) {
    var allowance = Math.max(0, P.pace * (P.cash + wk.gbp) - wk.gbp);
    if (allowance < budget) { budget = allowance; paceNote = 'weekly pace limit'; }
  }
  var newLeft = P.newPerWeek === null ? 99 : Math.max(0, P.newPerWeek - wk.newCount);
  out.filter(function (v) { return v.pendingW > 0; }).sort(function (a, b) { return b.priority - a.priority; }).forEach(function (v) {
    var wantW = v.pendingW, room = P.maxInd - (byInd[v.indKey] || 0);
    if (v.valueNow === 0 && newLeft <= 0) { v.action = 'Wait'; v.actionWhy = 'Qualifies; new-position limit for this week reached'; return; }
    if (room <= 0) { v.action = 'Wait'; v.actionWhy = 'Industry at its ' + Math.round(P.maxInd * 100) + '% cap'; return; }
    var gbp = Math.min(wantW, room) * total;
    if (gbp > budget) gbp = budget;
    if (gbp < P.minOrder) { v.action = v.valueNow > 0 ? 'Hold' : 'Wait'; v.actionWhy = budget < P.minOrder ? (paceNote ? 'Qualifies; this week\'s pace limit is used up' : 'Qualifies, but no cash left after reserve') : 'Order below minimum'; return; }
    budget -= gbp; if (v.valueNow === 0) newLeft--; byInd[v.indKey] = (byInd[v.indKey] || 0) + gbp / total;
    v.orderGBP = gbp;
    orders.push({ action: v.action, v: v, gbp: gbp, why: v.actionWhy });
  });
  orders.sort(function (a, b) { var o = { Sell: 0, Trim: 1, Buy: 2, Add: 3 }; return o[a.action] - o[b.action] || Math.abs(b.gbp) - Math.abs(a.gbp); });
  orders.meta = { scale: scale, qualifiers: out.filter(function (v) { return v._q; }).length, total: total, cash: P.cash, invested: invested, reserve: P.reserve * total, sells: sells,
    buys: orders.filter(function (o) { return o.gbp > 0; }).reduce(function (a, o) { return a + o.gbp; }, 0) };
  return orders;
}

/** Consecutive weekly History snapshots (latest backwards) in which each ticker had a warning setup. */
function warningStreaks_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET2.HIST), out = {};
  if (!sh || sh.getLastRow() < 2 || sh.getLastColumn() < 6) return out;
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues(), by = {};
  rows.forEach(function (r) { var t = String(r[1]).toUpperCase(); if (t) (by[t] = by[t] || []).push([String(r[0]), String(r[5] || '')]); });
  Object.keys(by).forEach(function (t) {
    var a = by[t].sort(function (x, y) { return x[0] < y[0] ? 1 : -1; }), n = 0;
    for (var i = 0; i < a.length; i++) { if (WARN_SETUPS[a[i][1]]) n++; else break; }
    out[t] = n;
  });
  return out;
}

/** Order log lookups: last buy (days ago, local price) and whether a trim was done during the current warning. */
function orderLogIndex_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(ORDERS.LOG), rows = [];
  if (sh && sh.getLastRow() > 1) rows = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues();
  var now = Date.now();
  var days = function (d) { var t = d instanceof Date ? d.getTime() : Date.parse(d); return isNaN(t) ? 9999 : (now - t) / 864e5; };
  return {
    lastBuy: function (t) {
      var b = null;
      rows.forEach(function (r) { if (String(r[2]).toUpperCase() === t && (r[1] === 'Buy' || r[1] === 'Add')) { var d = days(r[0]); if (!b || d < b.days) b = { days: d, price: Number(r[5]) || null }; } });
      return b;
    },
    weekBuys: function () {
      var gbp = 0, newT = {};
      rows.forEach(function (r) { if ((r[1] === 'Buy' || r[1] === 'Add') && days(r[0]) < 7) { gbp += Number(r[3]) || 0; if (r[1] === 'Buy') newT[String(r[2]).toUpperCase()] = 1; } });
      return { gbp: gbp, newCount: Object.keys(newT).length };
    },
    lastTrimAfter: function (t, weeks) {
      var limit = Math.max(weeks, 1) * 7 + 3;
      return rows.some(function (r) { return String(r[2]).toUpperCase() === t && r[1] === 'Trim' && days(r[0]) <= limit; });
    }
  };
}

var ORDER_COLS = ['Done', 'Action', 'Ticker', 'Name', 'Amount (£)', 'Approx. shares', 'Price (local)', 'Currency',
  'Weight now', 'Target weight', 'Setup', 'Strength', 'Reason'];
function writeOrders_(orders) {
  var ss = SpreadsheetApp.getActive();
  var sh = ensureSheet_(ORDERS.NAME, ORDER_COLS);
  sh.getRange(1, 1, 1, ORDER_COLS.length).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F3A5F');
  if (sh.getMaxRows() > 1) sh.getRange(2, 1, sh.getMaxRows() - 1, ORDER_COLS.length + 4).clearContent().clearDataValidations();
  var rows = orders.map(function (o) {
    var v = o.v, sh_ = v.priceGBP ? Math.abs(o.gbp) / v.priceGBP : '';
    return [false, o.action, v.ticker, v.name || '', Math.round(Math.abs(o.gbp)), sh_ === '' ? '' : Math.round(sh_ * 100) / 100,
      v.localPrice || '', v.localCcy, v.weightNow, v.targetW === '' ? '' : v.targetW, v.setup || '', v.setupScore === null ? '' : v.setupScore, o.why];
  });
  if (rows.length) {
    sh.getRange(2, 1, rows.length, ORDER_COLS.length).setValues(rows);
    sh.getRange(2, 1, rows.length, 1).insertCheckboxes();
    sh.getRange(2, 5, rows.length, 1).setNumberFormat('£#,##0');
    sh.getRange(2, 9, rows.length, 2).setNumberFormat('0.0%');
  } else sh.getRange(2, 2).setValue('No orders: nothing qualifies to buy and no holding triggers a sell or trim.');
  var M = orders.meta || {};
  var sc = ORDER_COLS.length + 2;
  var summary = [['Summary', ''], ['Portfolio value (£)', M.total || ''], ['Invested (£)', M.invested || ''], ['Cash available (£)', M.cash || 0],
    ['Cash reserve kept (£)', M.reserve || ''], ['Sells and trims (£)', M.sells || 0], ['Buys and adds (£)', M.buys || 0],
    ['Cash after buys (£)', (M.cash || 0) - (M.buys || 0)], ['Cash after sells are done (£)', (M.cash || 0) - (M.buys || 0) + (M.sells || 0)], ['Updated', new Date()],
    ['Stocks in the plan', M.qualifiers || 0],
    ['Targets scaled to fit', M.scale !== undefined && M.scale < 1 ? Math.round(M.scale * 100) + '% of stand-alone size' : 'No'], ['', ''],
    ['How to use', 'Place each order, then tick Done.'], ['', 'Holdings and Cash available update automatically.'],
    ['', 'Correct shares or cash if the fill differed.'], ['', 'Rules and limits: Rules tab and Assumptions.']];
  sh.getRange(1, sc, summary.length, 2).setValues(summary);
  sh.getRange(2, sc + 1, 8, 1).setNumberFormat('£#,##0');
  sh.getRange(1, sc, 1, 2).setFontWeight('bold');
  sh.getRange(1, sc, summary.length, 2).setWrap(false);
  sh.setColumnWidth(sc, 170); sh.setColumnWidth(sc + 1, 320);
  [60, 60, 70, 180, 90, 90, 90, 70, 80, 90, 140, 70, 420].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(1);
}

/** Tick Done on the Orders tab: log the trade, update Holdings and cash. */
function executeOrder_(row) {
  var ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(ORDERS.NAME);
  var r = sh.getRange(row, 1, 1, ORDER_COLS.length).getValues()[0];
  var action = r[1], t = String(r[2]).toUpperCase(), gbp = Number(r[4]) || 0, shares = Number(r[5]) || 0, price = r[6], ccy = r[7];
  if (!t || !action || !(shares > 0)) return;
  var log = ensureSheet_(ORDERS.LOG, ['Date', 'Action', 'Ticker', 'Amount (£)', 'Shares', 'Price (local)', 'Currency', 'Reason']);
  log.appendRow([new Date(), action, t, gbp, shares, price, ccy, r[12]]);
  var hs = ss.getSheetByName(SHEET.HOLDINGS);
  var vals = hs.getLastRow() > 1 ? hs.getRange(2, 1, hs.getLastRow() - 1, 5).getValues() : [];
  var idx = -1; vals.forEach(function (x, i) { if (String(x[0]).toUpperCase() === t) idx = i; });
  var buy = action === 'Buy' || action === 'Add';
  if (buy) {
    if (idx >= 0) {
      var s0 = Number(vals[idx][3]) || 0, c0 = Number(vals[idx][4]) || 0;
      hs.getRange(idx + 2, 4, 1, 2).setValues([[s0 + shares, (s0 * c0 + gbp) / (s0 + shares)]]);
    } else {
      var mk = '';
      var tk = ss.getSheetByName(SHEET.TICKERS).getRange(2, 1, Math.max(ss.getSheetByName(SHEET.TICKERS).getLastRow() - 1, 1), 3).getValues();
      tk.forEach(function (x) { if (String(x[0]).toUpperCase() === t) mk = String(x[2] || 'US').toUpperCase(); });
      var market = mk === 'US' || mk === '' ? 'US-listed shares' : mk === 'UK' ? 'UK shares' : mk + ' shares';
      var at = Math.max(hs.getLastRow() + 1, 2);
      hs.getRange(at, 1, 1, 5).setValues([[t, r[3], market, shares, gbp / shares]]);
    }
  } else if (idx >= 0) {
    var left = (Number(vals[idx][3]) || 0) - shares;
    if (action === 'Sell' || left <= 1e-6) hs.deleteRow(idx + 2); else hs.getRange(idx + 2, 4).setValue(left);
  }
  // Cash available
  var a = ss.getSheetByName(SHEET.ASSUME), labels = a.getRange(1, 1, a.getLastRow(), 1).getValues();
  labels.forEach(function (l, i) {
    if (String(l[0]).trim() === 'Cash available (£)') {
      var c = Number(a.getRange(i + 1, 2).getValue()) || 0;
      a.getRange(i + 1, 2).setValue(Math.round((c + (buy ? -gbp : gbp)) * 100) / 100);
    }
  });
  writeHoldingsFormulas_();
}

var RULES_TEXT = [
  ['How the rules work', ''],
  ['1. Gate', 'Only stocks whose business is improving qualify: Direction 75% or higher.'],
  ['2. Rank', 'Buy-type setup (Value setup, Compounder, Quality pullback) with Strength 5+ out of 7. A missing Trend point is not held against it.'],
  ['3. Confirm', 'Forecasts must not be falling (built into the setups) and the price must need no more growth than expected (Expectations gap 2% or lower).'],
  ['4. Size', 'Stand-alone target = best-ideas cap x (40% + 60% x conviction). Conviction blends Strength, expected return, the expectations cushion and Direction. Cyclicals use the lower cyclical cap. When many stocks qualify, targets are scaled down together so they fit in the portfolio (after the cash reserve and the holdings that do not qualify); if that would make positions smaller than the minimum position, only the strongest qualifiers are kept.'],
  ['5. Buy', 'Above the 200-day average: buy the full target. Below it: buy a third now, the next third after the set number of days or on a further 10% fall.'],
  ['6. Cash', 'Money goes to qualifying stocks, strongest first, keeping the cash reserve and the per-industry cap. A pace limit spreads it over weeks: at most the set share of cash, and the set number of new positions, in any 7 days. Anything left stays in cash until the next opportunity.'],
  ['7. Warnings', 'Value, estimates falling / Trend broken / High debt / Cash burner on a holding: halve it, then sell the rest if the warning lasts the set number of weeks.'],
  ['8. Trims', 'Any holding above the hard cap is trimmed to target. Stretched holdings (expected return below the Stretched level) with no buy setup and Direction under 75% are trimmed by a third: winners whose business is still improving strongly are left to run. Speculative holdings above 1.5x the speculative cap are trimmed to the cap.'],
  ['9. Hold', 'Everything else is held. Unqualified holdings are never added to.'],
  ['', ''],
  ['Your routine', 'Check the Orders tab after the morning data update. Place the orders, tick Done. Nothing else is needed; change the limits on Assumptions if you want a different style.'],
  ['', ''],
  ['Actions', 'Buy / Add: place the order shown. Trim / Sell: reduce as shown. Hold: nothing to do. Wait: qualifies but waiting (next third not due, industry cap, or no cash). Watch: a setup that misses a rule.'],
  ['', ''],
  ['Limits of the rules', 'The cash-burner veto is the only rule proven in the back-test (2023-26, your own trades). The setups have not yet been tested on outcomes: the History tab is recording them weekly so they can be. The rules decide; they cannot know news the data has not caught.']
];
function writeRulesTab_() {
  var sh = ensureSheet_(ORDERS.RULES, ['Rule', 'What it does']);
  sh.getRange(1, 1, RULES_TEXT.length, 2).setValues(RULES_TEXT).setWrap(true).setVerticalAlignment('top');
  sh.getRange(1, 1, 1, 2).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F3A5F');
  sh.getRange(2, 1, RULES_TEXT.length - 1, 1).setFontWeight('bold');
  sh.setColumnWidth(1, 170); sh.setColumnWidth(2, 760);
}

/** Colours for Status and Signal columns (replaces earlier rules on these tabs). */
function writeColourRules_() {
  var ss = SpreadsheetApp.getActive();
  var colours = { 'Stretched': '#F4C7C3', 'Above fair value': '#FCE8B2', 'Fair': '#E8EAED', 'Cheap': '#B7E1CD',
    'Buy zone': '#B7E1CD', 'Approaching': '#D9EAD3', 'Value trap?': '#FCE8B2', 'Speculative': '#D9D2E9',
    'Value setup': '#B7E1CD', 'Compounder': '#C9DAF8', 'Quality pullback': '#D0E0E3', 'Value, estimates falling': '#FFF2CC', 'Trend broken': '#F4C7C3',
    'Thin targets': '#E8EAED', 'Cash burner': '#E6B8AF', 'High debt': '#F9CB9C',
    'Buy': '#B7E1CD', 'Add': '#D9EAD3', 'Trim': '#FCE8B2', 'Sell': '#F4C7C3', 'Wait': '#FFF2CC', 'Watch': '#E8EAED' };
  var apply = function (sh, a1s) {
    if (!sh) return;
    var ranges = a1s.map(function (a) { return sh.getRange(a); }), rules = [];
    Object.keys(colours).forEach(function (k) {
      rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(k).setBackground(colours[k]).setRanges(ranges).build());
    });
    sh.setConditionalFormatRules(rules);
  };
  var span = function (L) { return L + '2:' + L + '500'; };
  apply(ss.getSheetByName(SHEET.HOLDINGS), [span(holdingsCol_('Status')), span(holdingsCol_('Setup')), span(holdingsCol_('Action'))]);
  apply(ss.getSheetByName(SHEET2.WATCH), [span(watchCol_('Signal')), span(watchCol_('Setup')), span(watchCol_('Action'))]);
  apply(ss.getSheetByName(ORDERS.NAME), ['B2:B500']);
  apply(ss.getSheetByName(SHEET2.CALC), [calcL_('Status') + '2:' + calcL_('Watch signal') + '500', span(calcL_('Setup'))]);
  apply(ss.getSheetByName(SHEET2.SETUPS), ['A2:A500']);
}

/* ======================================================================== */
/*  STOCK VIEW — one-stock dashboard driven by the ticker in C2             */
/* ======================================================================== */

// Layout for a wide (27-inch) screen: three charts per row, about 780 x 330 px each.
var SV = { NAME: 'Stock view', NOTES: 'Stock notes', TICKER: 'C2', NOTE_CELL: 'R68', NOTE_RANGE: 'R68:X80',
  GRID_ROW: 49, GRID_COL: 18, HELP_COL: 40, CW: 780, CH: 330 };   // helper data from column AN

/** Formula that looks up a column (by header) for the selected ticker on another tab. */
function svLook_(sheet, header) {
  var q = "'" + sheet + "'";
  return 'IFERROR(INDEX(' + q + '!$A$1:$ZZ$2000,MATCH(SV_TICKER,' + q + '!$A$1:$A$2000,0),MATCH("' + header + '",' + q + '!$A$1:$ZZ$1,0)),"")';
}

/** Builds (or rebuilds) the Stock view tab: layout, helper tables and charts. */
function buildStockView_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SV.NAME) || ss.insertSheet(SV.NAME);
  sh.getCharts().forEach(function (c) { sh.removeChart(c); });
  var keep = sh.getRange(SV.TICKER).getValue();
  sh.clear();
  if (sh.getMaxColumns() < 70) sh.insertColumnsAfter(sh.getMaxColumns(), 70 - sh.getMaxColumns());
  if (sh.getMaxRows() < 420) sh.insertRowsAfter(sh.getMaxRows(), 420 - sh.getMaxRows());
  sh.setHiddenGridlines(true);
  sh.setColumnWidth(1, 16);
  for (var c = 2; c <= 25; c++) sh.setColumnWidth(c, 100);
  ss.setNamedRange('SV_TICKER', sh.getRange(SV.TICKER));

  // Header and selector
  sh.getRange('B2').setValue('Stock').setFontColor('#5F5E5A');
  var calc = ss.getSheetByName(SHEET2.CALC);
  var rule = SpreadsheetApp.newDataValidation().requireValueInRange(calc.getRange('A2:A2000'), true).setAllowInvalid(false).build();
  sh.getRange(SV.TICKER).setDataValidation(rule).setFontWeight('bold').setFontSize(12).setBackground('#FFF4CC')
    .setValue(keep || (calc.getLastRow() > 1 ? calc.getRange('A2').getValue() : ''));
  sh.getRange('D2:K2').merge().getCell(1, 1).setFormula('=' + svLook_(SHEET2.CALC, 'Name')).setFontSize(16).setFontWeight('bold');
  sh.getRange('D3:K3').merge().getCell(1, 1).setFormula('=TEXTJOIN("  ·  ",TRUE,' + svLook_(SHEET2.CALC, 'Sector') + ',' + svLook_(SHEET2.CALC, 'Industry') + ',' +
    svLook_(SHEET2.CALC, 'Type') + ',' + svLook_(SHEET2.CALC, 'List') + ',IF(' + svLook_(SHEET2.CALC, 'Currency') + '="","","Prices in "&' + svLook_(SHEET2.CALC, 'Currency') + '))').setFontColor('#5F5E5A');
  sh.getRange('M2').setFormula('=' + svLook_(SHEET2.CALC, 'Price')).setFontSize(16).setFontWeight('bold').setNumberFormat('#,##0.00');
  sh.getRange('N2:O2').merge().getCell(1, 1).setFormula('=' + svLook_(SHEET2.CALC, 'Status')).setFontWeight('bold').setHorizontalAlignment('center');
  sh.getRange('M3:O3').merge().getCell(1, 1).setFormula('="Data as of "&' + svLook_(SHEET2.CALC, 'Data as of')).setFontColor('#888780').setFontSize(9);

  sh.getRange('D4:R4').merge().getCell(1, 1).setFormula('=IF(' + svLook_(SHEET2.CALC, 'Setup') + '="","No setup.   ","Setup: "&' + svLook_(SHEET2.CALC, 'Setup') + '&"   ")&' +
    svLook_(SHEET2.CALC, 'Setup checks')).setFontWeight('bold').setFontColor('#1F3A5F');

  // Metric cards
  var cards = [['Fair value', 'Fair value', '#,##0.00'], ['Upside', 'Upside', '+0%;[Red]-0%'],
    ['Exp. return a year', 'Exp. 5-yr return (a year)', '0.0%;[Red]-0.0%'], ['PEG', 'PEG', '0.00'],
    ['Direction', 'Direction', '@'], ['Implied growth', 'Implied growth (reverse DCF)', '0.0%'],
    ['Expected growth', 'Expected growth (comparable)', '0.0%'], ['Analyst target', 'Analyst target', '#,##0.00']];
  cards.forEach(function (k, i) {
    var col = 3 + 2 * i;
    sh.getRange(5, col, 1, 2).merge();
    sh.getRange(6, col, 1, 2).merge();
    sh.getRange(5, col).setValue(k[0]).setFontColor('#5F5E5A').setFontSize(9).setBackground('#F1EFE8').setHorizontalAlignment('center');
    sh.getRange(6, col).setFormula('=' + svLook_(SHEET2.CALC, k[1])).setNumberFormat(k[2]).setFontSize(16).setFontWeight('bold')
      .setBackground('#F1EFE8').setHorizontalAlignment('center');
  });
  sh.getRange('C7:R7').merge().getCell(1, 1).setFormula('=' + svLook_(SHEET2.CALC, 'Notes')).setFontColor('#888780').setFontSize(9).setWrap(true);
  sh.setRowHeight(7, 30);

  // Section headings
  var head = function (a1, text) { sh.getRange(a1).setValue(text).setFontWeight('bold').setFontColor('#444441'); };
  head('B9', '1 · Where the price sits'); head('J9', '2 · What each model says'); head('R9', 'Your position');
  head('B28', '3 · Revenue and free cash flow (millions, reporting currency)'); head('J28', '4 · Earnings per share: actual and forecast');
  head('R28', '5 · Price over 1 year');
  head('B47', '6 · Margins (% of revenue)'); head('J47', '7 · Next-year EPS estimate: how it has moved');
  head('R47', 'Sensitivity: fair value at different growth and discount rates');
  head('B66', 'Signals'); head('R66', 'Your notes (saved per stock)');

  // Your position (from Holdings)
  var pos = [['Shares', 'Shares', '#,##0.####'], ['Avg cost (£)', 'Avg cost (£)', '£#,##0.00'], ['Cost (£)', 'Cost (£)', '£#,##0'],
    ['Value (£)', 'Value (£)', '£#,##0'], ['Gain (£)', 'Gain (£)', '£#,##0;[Red]-£#,##0'], ['Gain %', 'Gain %', '0.0%;[Red]-0.0%'],
    ['Weight in portfolio', 'Weight %', '0.0%']];
  pos.forEach(function (p, i) {
    sh.getRange(10 + i, 18, 1, 2).merge().getCell(1, 1).setValue(p[0]).setFontColor('#5F5E5A');
    sh.getRange(10 + i, 20, 1, 2).merge().getCell(1, 1).setFormula('=IF(' + svLook_(SHEET.HOLDINGS, 'Ticker') + '="","",' + svLook_(SHEET.HOLDINGS, p[1]) + ')')
      .setNumberFormat(p[2]).setHorizontalAlignment('right');
  });
  sh.getRange('R17:U17').merge().getCell(1, 1).setFormula('=IF(' + svLook_(SHEET.HOLDINGS, 'Ticker') + '="","Not held (on your watchlist)","")').setFontColor('#888780');

  // ---- Helper tables (columns AA onwards, hidden) ----
  var H = SV.HELP_COL, put = function (r, c, v) { var cell = sh.getRange(r, H + c); if (String(v).charAt(0) === '=') cell.setFormula(v); else cell.setValue(v); };
  // T1 range bar: label | value | price
  var t1 = [['Low', 'Low'], ['Buy below', 'Buy below'], ['Fair value', 'Fair value'], ['High', 'High'], ['Analyst target', 'Analyst target']];
  put(1, 0, ''); put(1, 1, 'Model range'); put(1, 2, 'Price now');
  t1.forEach(function (t, i) { put(2 + i, 0, t[0]); put(2 + i, 1, '=N(' + svLook_(SHEET2.CALC, t[1]) + ')'); put(2 + i, 2, ''); });
  put(7, 0, 'Price'); put(7, 1, ''); put(7, 2, '=N(' + svLook_(SHEET2.CALC, 'Price') + ')');
  // T2 models: name | value | price
  put(9, 0, 'Model'); put(9, 1, 'Value'); put(9, 2, 'Price');
  MODEL_NAMES.forEach(function (m, i) {
    put(10 + i, 0, m); put(10 + i, 1, '=IFERROR(1/(1/' + svLook_(SHEET2.CALC, m) + '),)'); put(10 + i, 2, '=N(' + svLook_(SHEET2.CALC, 'Price') + ')');
  });
  // T3 revenue / FCF: year | revenue | FCF (millions)
  put(19, 0, 'Year'); put(19, 1, 'Revenue'); put(19, 2, 'Free cash flow');
  var fyEnd = svLook_(SHEET.RAW, 'Latest FY end');
  for (var i = 5; i >= 0; i--) {
    var r = 20 + (5 - i), sfx = i === 0 ? '0' : '-' + i;
    put(r, 0, '=IFERROR("FY"&(YEAR(' + fyEnd + ')-' + i + '),"FY-' + i + '")');
    put(r, 1, '=IFERROR(1/(1/(' + svLook_(SHEET.RAW, 'Revenue FY' + sfx) + '/1e6)),)');
    put(r, 2, '=IFERROR((' + svLook_(SHEET.RAW, 'OCF FY' + sfx) + '-N(' + svLook_(SHEET.RAW, 'Capex FY' + sfx) + '))/1e6,)');
  }
  put(26, 0, 'Last 12m'); put(26, 1, '=IFERROR(1/(1/(' + svLook_(SHEET.RAW, 'Revenue TTM') + '/1e6)),)');
  put(26, 2, '=IFERROR((' + svLook_(SHEET.RAW, 'OCF TTM') + '-N(' + svLook_(SHEET.RAW, 'Capex TTM') + '))/1e6,)');
  // T5 EPS: year | actual | forecast
  put(28, 0, 'Year'); put(28, 1, 'Actual EPS'); put(28, 2, 'Analyst forecast');
  for (var j = 5; j >= 0; j--) {
    var rr = 29 + (5 - j), s2 = j === 0 ? '0' : '-' + j;
    put(rr, 0, '=IFERROR("FY"&(YEAR(' + fyEnd + ')-' + j + '),"FY-' + j + '")');
    put(rr, 1, '=IFERROR(1/(1/' + svLook_(SHEET.RAW, 'EPS FY' + s2) + '),)'); put(rr, 2, '');
  }
  put(35, 0, '=IFERROR("FY"&(YEAR(' + fyEnd + ')+1)&"e","Next yr")'); put(35, 1, '');
  put(35, 2, '=IFERROR(1/(1/' + svLook_(SHEET.RAW, 'Est EPS FY1') + '),)');
  put(36, 0, '=IFERROR("FY"&(YEAR(' + fyEnd + ')+2)&"e","Yr after")'); put(36, 1, '');
  put(36, 2, '=IFERROR(1/(1/' + svLook_(SHEET.RAW, 'Est EPS FY2') + '),)');
  // T6 margins: year | gross | operating | net
  put(38, 0, 'Year'); put(38, 1, 'Gross margin'); put(38, 2, 'Operating margin'); put(38, 3, 'Net margin');
  // Margins as % of revenue, clipped to -100%..+100% so one extreme year doesn't flatten the chart
  var mg = function (num, sfx) { return '=IFERROR(MAX(-1,MIN(1,' + svLook_(SHEET.RAW, num + sfx) + '/' + svLook_(SHEET.RAW, 'Revenue' + sfx) + ')),)'; };
  for (var k = 5; k >= 0; k--) {
    var r3 = 39 + (5 - k), s3 = k === 0 ? ' FY0' : ' FY-' + k;
    sh.getRange(r3, H).setFormula('=' + colL_(H) + (20 + 5 - k));
    put(r3, 1, mg('GrossProfit', s3)); put(r3, 2, mg('OperatingIncome', s3)); put(r3, 3, mg('NetIncome', s3));
  }
  sh.getRange(39, H + 1, 7, 3).setNumberFormat('0.0%');
  put(45, 0, 'Last 12m'); put(45, 1, mg('GrossProfit', ' TTM')); put(45, 2, mg('OperatingIncome', ' TTM')); put(45, 3, mg('NetIncome', ' TTM'));
  // T7 estimate trend
  put(47, 0, ''); put(47, 1, 'Next-year EPS estimate');
  put(48, 0, '90 days ago'); put(48, 1, '=IFERROR(1/(1/' + svLook_(SHEET.RAW, 'EPS est 90d ago') + '),)');
  put(49, 0, '30 days ago'); put(49, 1, '=IFERROR(1/(1/' + svLook_(SHEET.RAW, 'EPS est 30d ago') + '),)');
  put(50, 0, 'Now'); put(50, 1, '=IFERROR(1/(1/' + svLook_(SHEET.RAW, 'EPS est now') + '),)');
  // T4 price history: one price pull (about 21 months), then a last-12-months table with a
  // 200-day average (about 290 calendar days) and the fair value line, using plain formulas only.
  var sym = 'IFERROR(VLOOKUP(SV_TICKER,Market!$A:$B,2,FALSE),SV_TICKER)';
  // Price table: Date | Price | 200-day avg | Fair value | 15% / 30% / 50% below fair value | Analyst target.
  // Fair value and target are held as single cells in row 1 of columns H+18 and H+19.
  var P = colL_(H + 6), Q = colL_(H + 7), T = colL_(H + 10), FVC = colL_(H + 18), TGC = colL_(H + 19);
  sh.getRange(1, H + 6).setFormula('=IFERROR(GOOGLEFINANCE(' + sym + ',"close",TODAY()-660,TODAY()),"")');
  sh.getRange(1, H + 18).setFormula('=N(' + svLook_(SHEET2.CALC, 'Fair value') + ')');
  sh.getRange(1, H + 19).setFormula('=N(' + svLook_(SHEET2.CALC, 'Analyst target') + ')');
  sh.getRange(1, H + 10, 1, 8).setValues([['Date', 'Price', '200-day average', 'Fair value', '15% below fair value',
    '30% below fair value', '50% below fair value', 'Analyst target']]);
  sh.getRange(2, H + 10).setFormula('=IFERROR(FILTER(' + P + '2:' + Q + '700,ISNUMBER(' + Q + '2:' + Q + '700),' + P + '2:' + P + '700>=TODAY()-365),"")');
  var rows = [];
  var lvl = function (pr, expr, ref) { return '=IF(AND(ISNUMBER(' + T + pr + '),$' + ref + '$1>0),' + expr + ',"")'; };
  for (var pr = 2; pr <= 300; pr++) {
    rows.push(['=IF(ISNUMBER(' + T + pr + '),AVERAGEIFS($' + Q + '$2:$' + Q + '$700,$' + P + '$2:$' + P + '$700,">"&(' + T + pr + '-290),$' + P + '$2:$' + P + '$700,"<="&' + T + pr + '),"")',
      lvl(pr, '$' + FVC + '$1', FVC), lvl(pr, '$' + FVC + '$1*0.85', FVC), lvl(pr, '$' + FVC + '$1*0.7', FVC),
      lvl(pr, '$' + FVC + '$1*0.5', FVC), lvl(pr, '$' + TGC + '$1', TGC)]);
  }
  sh.getRange(2, H + 12, rows.length, 6).setFormulas(rows);
  sh.getRange(2, H + 10, 299, 1).setNumberFormat('d mmm yy');
  sh.hideColumns(H, 20);

  // ---- Charts ----
  var hr = function (r1, c1, rows, cols) { return sh.getRange(r1, H + c1, rows, cols); };
  var add = function (builder, row, col, w, h) { sh.insertChart(builder.setPosition(row, col, 0, 0).setOption('width', w).setOption('height', h).build()); };
  add(sh.newChart().setChartType(Charts.ChartType.BAR).addRange(hr(1, 0, 7, 3)).setNumHeaders(1).setOption('isStacked', true)
    .setOption('legend', { position: 'bottom' }).setOption('colors', ['#5DCAA5', '#185FA5']).setOption('hAxis', { minValue: 0 }), 10, 2, SV.CW, SV.CH);
  add(sh.newChart().setChartType(Charts.ChartType.COMBO).addRange(hr(9, 0, 9, 3)).setNumHeaders(1)
    .setOption('seriesType', 'bars').setOption('series', { 1: { type: 'line', lineDashStyle: [4, 4] } })
    .setOption('colors', ['#5DCAA5', '#185FA5']).setOption('legend', { position: 'bottom' }).setOption('vAxis', { title: 'Value per share' }), 10, 10, SV.CW, SV.CH);
  add(sh.newChart().setChartType(Charts.ChartType.COLUMN).addRange(hr(19, 0, 8, 3)).setNumHeaders(1)
    .setOption('colors', ['#85B7EB', '#1D9E75']).setOption('legend', { position: 'bottom' }).setOption('vAxis', { title: 'Millions' }), 29, 2, SV.CW, SV.CH);
  add(sh.newChart().setChartType(Charts.ChartType.LINE).addRange(sh.getRange(1, H + 10, 300, 8)).setNumHeaders(1)
    .setOption('vAxis', { title: 'Price' }).setOption('hAxis', { format: 'MMM yy' })
    .setOption('colors', ['#378ADD', '#888780', '#0F6E56', '#5DCAA5', '#97C459', '#C0DD97', '#7F77DD'])
    .setOption('legend', { position: 'bottom' })
    .setOption('series', { 0: { lineWidth: 2.5 }, 1: { lineDashStyle: [3, 3], lineWidth: 1.5 }, 2: { lineDashStyle: [8, 4], lineWidth: 2 },
      3: { lineDashStyle: [2, 3], lineWidth: 1 }, 4: { lineDashStyle: [2, 3], lineWidth: 1 }, 5: { lineDashStyle: [2, 3], lineWidth: 1 },
      6: { lineDashStyle: [10, 4], lineWidth: 1.5 } }), 29, 18, SV.CW, SV.CH);
  add(sh.newChart().setChartType(Charts.ChartType.COLUMN).addRange(hr(28, 0, 9, 3)).setNumHeaders(1).setOption('isStacked', true)
    .setOption('colors', ['#378ADD', '#AFA9EC']).setOption('legend', { position: 'bottom' }).setOption('vAxis', { title: 'EPS per share' }), 29, 10, SV.CW, SV.CH);
  add(sh.newChart().setChartType(Charts.ChartType.LINE).addRange(hr(38, 0, 8, 4)).setNumHeaders(1)
    .setOption('colors', ['#1D9E75', '#378ADD', '#7F77DD']).setOption('legend', { position: 'bottom' })
    .setOption('vAxis', { format: 'percent', title: '% of revenue (clipped at ±100%)' }).setOption('pointSize', 4), 48, 2, SV.CW, SV.CH);
  add(sh.newChart().setChartType(Charts.ChartType.COLUMN).addRange(hr(47, 0, 4, 2)).setNumHeaders(1)
    .setOption('colors', ['#7F77DD']).setOption('legend', { position: 'none' }).setOption('vAxis', { title: 'EPS per share' }), 48, 10, SV.CW, SV.CH);

  // Signals row (8 cells from the Calc "Signals" text) and earnings line
  sh.getRange('B67').setFormula('=IFERROR(SPLIT(' + svLook_(SHEET2.CALC, 'Signals') + ',"  ",FALSE),"")');
  sh.getRange('B67:I67').setHorizontalAlignment('center').setFontSize(11);
  var sig = sh.getRange('B67:I67');
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextContains('↑').setBackground('#EAF3DE').setFontColor('#27500A').setRanges([sig]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextContains('↓').setBackground('#FCEBEB').setFontColor('#791F1F').setRanges([sig]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Cheap').setBackground('#B7E1CD').setRanges([sh.getRange('N2')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Fair').setBackground('#E8EAED').setRanges([sh.getRange('N2')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Above fair value').setBackground('#FCE8B2').setRanges([sh.getRange('N2')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Stretched').setBackground('#F4C7C3').setRanges([sh.getRange('N2')]).build()
  ]);
  sh.getRange('B68:P68').merge().getCell(1, 1).setFormula('="Next earnings: "&' + svLook_(SHEET2.CALC, 'Next earnings') +
    '&"     Last EPS surprise: "&IFERROR(TEXT(' + svLook_(SHEET2.CALC, 'Last EPS surprise') + ',"+0.0%;-0.0%"),"n/a")' +
    '&"     Revisions (30 days): "&' + svLook_(SHEET2.CALC, 'Analyst revisions 30d')).setFontColor('#5F5E5A');

  // Notes box
  sh.getRange(SV.NOTE_RANGE).merge().setBackground('#FFF4CC').setVerticalAlignment('top').setWrap(true)
    .setBorder(true, true, true, true, false, false, '#D3D1C7', SpreadsheetApp.BorderStyle.SOLID);
  sh.setFrozenRows(3);
  renderStockView_();
}

/* ---- Selection, notes, sensitivity ---- */

function notesSheet_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SV.NOTES);
  if (!sh) { sh = ss.insertSheet(SV.NOTES); sh.getRange(1, 1, 1, 3).setValues([['Ticker', 'Note', 'Updated']]); sh.hideSheet(); }
  return sh;
}
function getNote_(t) {
  var sh = notesSheet_(); if (sh.getLastRow() < 2) return '';
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  for (var i = 0; i < v.length; i++) if (String(v[i][0]).toUpperCase() === t) return v[i][1];
  return '';
}
function saveNote_(t, text) {
  if (!t) return;
  var sh = notesSheet_(), last = sh.getLastRow();
  var v = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues() : [];
  for (var i = 0; i < v.length; i++) if (String(v[i][0]).toUpperCase() === t) { sh.getRange(i + 2, 2, 1, 2).setValues([[text, new Date()]]); return; }
  sh.getRange(last + 1, 1, 1, 3).setValues([[t, text, new Date()]]);
}

/** Fills the parts of the Stock view the script owns: notes and the sensitivity grid. */
function renderStockView_() {
  var ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(SV.NAME);
  if (!sh) return;
  var t = String(sh.getRange(SV.TICKER).getValue()).trim().toUpperCase();
  sh.getRange(SV.NOTE_CELL).setValue(t ? getNote_(t) : '');
  var grid = t ? sensitivityFor_(t) : null;
  var G0 = SV.GRID_ROW, C0 = SV.GRID_COL;
  var area = sh.getRange(G0, C0, 10, 8);
  area.breakApart().clearContent().setBackground(null).setFontWeight('normal');
  if (!grid) { sh.getRange(G0, C0).setValue('No valuation for this stock.'); return; }
  var out = [[grid.byMargin ? 'Long-run net margin ↓  Discount rate →' : 'Start growth ↓  Discount rate →'].concat(grid.rVals.map(function (r) { return r; }))];
  grid.gVals.forEach(function (g, i) { out.push([g].concat(grid.rows[i])); });
  sh.getRange(G0, C0, out.length, out[0].length).setValues(out);
  sh.getRange(G0, C0 + 1, 1, grid.rVals.length).setNumberFormat('0.0%').setFontWeight('bold').setBackground('#F1EFE8');
  sh.getRange(G0 + 1, C0, grid.gVals.length, 1).setNumberFormat('0.0%').setFontWeight('bold').setBackground('#F1EFE8');
  sh.getRange(G0 + 1, C0 + 1, grid.gVals.length, grid.rVals.length).setNumberFormat('#,##0.00');
  sh.getRange(G0 + 1 + grid.baseRow, C0 + 1 + grid.baseCol).setBackground('#CECBF6').setFontWeight('bold');
  var price = grid.price, cells = sh.getRange(G0 + 1, C0 + 1, grid.gVals.length, grid.rVals.length);
  if (price) {
    var bg = grid.rows.map(function (row) { return row.map(function (v) { return v === '' ? null : v >= price ? '#EAF3DE' : '#FCEBEB'; }); });
    bg[grid.baseRow][grid.baseCol] = '#CECBF6';
    cells.setBackgrounds(bg);
  }
  sh.getRange(G0 + 1 + grid.gVals.length, C0, 1, 8).merge().getCell(1, 1).setValue((grid.byMargin ?
    'Cyclical stock: rows show profit margins from a quarter to 1.5x the model\'s long-run margin (the risk is the cycle turning). ' : '') +
    'Green where fair value is above today\'s price, red where below. Purple = current settings.')
    .setFontColor('#888780').setFontSize(9);
}

/** Blended fair value across start-growth and discount-rate scenarios for one ticker. */
function sensitivityFor_(t) {
  var ss = SpreadsheetApp.getActive();
  var today = dnum_(Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd'));
  var S = settingsFromMap_(assumptionsMap_());
  var raw = sheetObjects_(SHEET.RAW, 'Ticker')[t];
  if (!raw) return null;
  var mk = ss.getSheetByName(SHEET.MARKET), m = {};
  if (mk.getLastRow() > 1) mk.getRange(2, 1, mk.getLastRow() - 1, MARKET_HEADERS.length).getValues().forEach(function (r) {
    if (String(r[0]).toUpperCase() === t) {
      var cur = String(r[4] || '').trim();
      m = { price: typeof r[3] === 'number' ? r[3] : null, currency: /^[A-Z]{3}$/.test(cur) ? cur : '',
        shares: typeof r[6] === 'number' ? r[6] : null, beta: typeof r[7] === 'number' ? r[7] : null,
        mcap: typeof r[5] === 'number' ? r[5] : null };
    }
  });
  var calc = sheetObjects_(SHEET2.CALC, 'Ticker')[t] || {};
  var tk = ss.getSheetByName(SHEET.TICKERS), ovr = {};
  if (tk.getLastRow() > 1) tk.getRange(2, 1, tk.getLastRow() - 1, 7).getValues().forEach(function (r) {
    if (String(r[0]).trim().toUpperCase() === t) ovr = { type: r[4], growth: r[5], margin: r[6] };
  });
  // Exchange rate as used on Calc (reported currency -> listing currency)
  var fx = 1;
  if (raw.Currency && m.currency && raw.Currency !== m.currency) {
    var pairs = fxRates_(m.currency === 'GBX' ? (raw.Currency === 'GBP' ? [] : [raw.Currency + 'GBP']) : [raw.Currency + m.currency]);
    fx = m.currency === 'GBX' ? (raw.Currency === 'GBP' ? 100 : (pairs[raw.Currency + 'GBP'] || 0) * 100) : (pairs[raw.Currency + m.currency] || 0);
    if (!fx) return null;
  }
  var base = valueCompany(raw, m, fx, ovr, S, null, today);
  if (!base.fv || base.g0 === undefined || base.r === undefined) return null;
  // Growth: 4 steps down, 2 up. Discount rate: 2 steps down, 4 up. Duplicate rows (growth floor) are dropped.
  // Deep cyclicals (memory, storage, metals...): rows vary long-run profit margins instead, since the risk is the cycle turning.
  var gVals = [], rVals = [];
  var byMargin = !!base.deepCyclical && base.mN > 0;
  var scales = [0.25, 0.5, 0.75, 1, 1.25, 1.5];
  if (byMargin) scales.forEach(function (k) { gVals.push(base.mN * k); });
  else [-0.20, -0.15, -0.10, -0.05, 0, 0.05, 0.10].forEach(function (d) {
    var g = d === 0 ? base.g0 : Math.max(base.g0 + d, S.gFloor);
    if (gVals.every(function (x) { return Math.abs(x - g) > 1e-9; })) gVals.push(g);
  });
  [-0.02, -0.01, 0, 0.01, 0.02, 0.03, 0.04].forEach(function (d) {
    var r = d === 0 ? base.r : Math.max(base.r + d, S.gTerm + 0.02);
    if (rVals.every(function (x) { return Math.abs(x - r) > 1e-9; })) rVals.push(r);
  });
  var rows = gVals.map(function (g, gi) {
    return rVals.map(function (r) {
      var S2 = {}; for (var k in S) S2[k] = S[k];
      S2.rMin = r; S2.rMax = r; S2.req = Math.max(S.req + (r - base.r), S.gTerm + 0.02);
      var o2 = byMargin ? { type: ovr.type, growth: ovr.growth, margin: ovr.margin, marginScale: scales[gi] }
        : { type: ovr.type, growth: ovr.growth, margin: ovr.margin, gridGrowth: g };
      var v = valueCompany(raw, m, fx, o2, S2, null, today);
      // Blend the same models as the base fair value, so scenarios are comparable (no price filter re-selection).
      var vals = (base.used || []).map(function (k) { return v.models[k]; }).filter(function (x) { return x > 0; });
      return vals.length ? median_(vals) : (v.fv ? v.fv : '');
    });
  });
  return { gVals: gVals, rVals: rVals, rows: rows, baseRow: byMargin ? 3 : gVals.indexOf(base.g0), baseCol: rVals.indexOf(base.r),
    price: m.price || n_(calc.Price), byMargin: byMargin };
}

/** Menu: show the ticker in the selected row (any tab) on the Stock view. */
function openInStockView() {
  var ss = SpreadsheetApp.getActive(), cell = ss.getActiveRange(), src = cell.getSheet();
  var t = String(src.getRange(cell.getRow(), 1).getValue()).trim().toUpperCase();
  var sh = ss.getSheetByName(SV.NAME);
  if (!sh) { buildStockView_(); sh = ss.getSheetByName(SV.NAME); }
  if (!t || cell.getRow() === 1) { ss.toast('Select a cell in a ticker row first.', 'Valuation', 5); return; }
  sh.getRange(SV.TICKER).setValue(t);
  renderStockView_();
  ss.setActiveSheet(sh);
}

/* Lets the parsing functions be tested outside Google (ignored by Apps Script). */
if (typeof module !== 'undefined') {
  module.exports = { TAGS: TAGS, valueCompany: valueCompany, settingsFromMap_: settingsFromMap_, dnum_: dnum_, CALC_COLS: CALC_COLS, parseCompany: parseCompany, parseCsv: parseCsv, buildRawRows: buildRawRows, RAW_COLS: RAW_COLS };
}
