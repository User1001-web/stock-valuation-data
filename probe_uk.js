const fs = require('fs');
(async () => {
  const YF = (await import('yahoo-finance2')).default;
  const yf = new YF({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
  const out = {};
  for (const s of ['LGEN.L', 'HSBA.L', 'BATS.L', 'TW.L', 'BLND.L', 'UKW.L']) {
    out[s] = {};
    try { out[s].annual = await yf.fundamentalsTimeSeries(s, { period1: '2019-01-01', type: 'annual', module: 'all' }, { validateResult: false }); }
    catch (e) { out[s].annualError = String(e.message).slice(0, 300); }
    try { out[s].trailing = await yf.fundamentalsTimeSeries(s, { period1: '2024-01-01', type: 'trailing', module: 'all' }, { validateResult: false }); }
    catch (e) { out[s].trailingError = String(e.message).slice(0, 300); }
    try { out[s].qs = await yf.quoteSummary(s, { modules: ['assetProfile', 'price', 'financialData', 'defaultKeyStatistics'] }, { validateResult: false }); }
    catch (e) { out[s].qsError = String(e.message).slice(0, 300); }
    await new Promise(r => setTimeout(r, 500));
  }
  fs.writeFileSync('data/uk_probe.json', JSON.stringify(out));
  console.log(Object.entries(out).map(([k, v]) => k + ' annual=' + (v.annual ? v.annual.length : v.annualError) + ' trailing=' + (v.trailing ? v.trailing.length : v.trailingError)).join('\n'));
})();
