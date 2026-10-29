// One-off test: which tickers does the FMP free plan cover for analyst estimates?
// Saves covered tickers' estimates to data/fmp/ and a coverage list (no key in output).
const fs = require('fs');
const KEY = process.env.FMP_KEY || '';
const rows = fs.readFileSync('data/raw_data.csv', 'utf8').split('\n').slice(1).map(l => l.split(','));
const tickers = rows.filter(r => r[3] && /^\d+$/.test(r[3])).map(r => r[0]);
(async () => {
  fs.mkdirSync('data/fmp', { recursive: true });
  const cov = [];
  for (const s of tickers) {
    const r = await fetch(`https://financialmodelingprep.com/stable/analyst-estimates?symbol=${s}&period=annual&page=0&limit=10&apikey=${KEY}`);
    const t = await r.text();
    cov.push(`${s},${r.status}`);
    if (r.status === 200) fs.writeFileSync(`data/fmp/${s}.json`, t);
    await new Promise(r => setTimeout(r, 250));
  }
  fs.writeFileSync('data/fmp_coverage.csv', 'ticker,status\n' + cov.join('\n') + '\n');
  console.log(cov.filter(c => c.endsWith(',200')).length + ' of ' + cov.length + ' covered');
})();
