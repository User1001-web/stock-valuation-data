// One-off: daily closes (split-adjusted) and split events for the back-test tickers.
const fs = require('fs');
(async () => {
  const YF = (await import('yahoo-finance2')).default;
  const yf = typeof YF === 'function' ? new YF({ suppressNotices: ['yahooSurvey'] }) : YF;
  const tickers = fs.readFileSync('backtest/tickers.txt', 'utf8').split(/\s+/).filter(Boolean);
  const px = ['ticker,date,close'], sp = ['ticker,date,ratio'];
  for (const t of tickers) {
    try {
      const c = await yf.chart(t.replace(/\./g, '-'), { period1: '2022-01-01', interval: '1d', events: 'split' });
      (c.quotes || []).forEach(q => { if (q.close) px.push([t, new Date(q.date).toISOString().slice(0, 10), q.close].join(',')); });
      const s = (c.events && c.events.splits) || [];
      s.forEach(x => sp.push([t, new Date(x.date).toISOString().slice(0, 10), x.numerator / x.denominator].join(',')));
      console.log(t, (c.quotes || []).length, 'days', s.length, 'splits');
    } catch (e) { console.log(t, 'FAILED', e.message); }
    await new Promise(r => setTimeout(r, 400));
  }
  fs.mkdirSync('data/backtest', { recursive: true });
  fs.writeFileSync('data/backtest/prices.csv', px.join('\n') + '\n');
  fs.writeFileSync('data/backtest/splits.csv', sp.join('\n') + '\n');
})();
