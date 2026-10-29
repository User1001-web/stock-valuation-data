// One-off test: Yahoo Finance analyst data coverage (unofficial; via the yahoo-finance2 package).
const fs = require('fs');
(async () => {
  const mod = await import('yahoo-finance2');
  const YF = mod.default;
  const yf = typeof YF === 'function' ? new YF({ suppressNotices: ['yahooSurvey'] }) : YF;
  const rows = fs.readFileSync('data/raw_data.csv', 'utf8').split('\n').slice(1).map(l => l.split(','));
  const tickers = rows.filter(r => r[3] && /^\d+$/.test(r[3])).map(r => r[0]).concat(['LGEN.L', 'AV.L', 'HSBA.L']);
  const out = [];
  for (const s of tickers) {
    try {
      const q = await yf.quoteSummary(s, { modules: ['financialData', 'earningsTrend'] }, { validateResult: false });
      const fd = q.financialData || {}, tr = (q.earningsTrend && q.earningsTrend.trend) || [];
      const y0 = tr.find(t => t.period === '0y') || {}, y1 = tr.find(t => t.period === '+1y') || {};
      out.push({ s, ok: true, target: fd.targetMeanPrice ?? null, analysts: fd.numberOfAnalystOpinions ?? null,
        rev0y: y0.revenueEstimate && y0.revenueEstimate.avg, rev1y: y1.revenueEstimate && y1.revenueEstimate.avg,
        revGrowth1y: y1.revenueEstimate && y1.revenueEstimate.growth, eps1y: y1.earningsEstimate && y1.earningsEstimate.avg, end1y: y1.endDate });
    } catch (e) { out.push({ s, ok: false, error: String(e.message).slice(0, 150) }); }
    await new Promise(r => setTimeout(r, 400));
  }
  fs.writeFileSync('data/yahoo_probe.json', JSON.stringify(out, null, 1));
  console.log(out.filter(o => o.ok && o.target).length + ' with targets, ' + out.filter(o => o.rev1y).length + ' with revenue estimates, of ' + out.length);
})();
