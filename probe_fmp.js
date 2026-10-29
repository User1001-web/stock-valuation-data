// One-off test: what does the FMP free plan return? Writes data/fmp_probe.json (no key in output).
const fs = require('fs');
const KEY = process.env.FMP_KEY || '';
const B = 'https://financialmodelingprep.com';
const eps = [
  ['estimates', s => `${B}/stable/analyst-estimates?symbol=${s}&period=annual&page=0&limit=10`],
  ['target-consensus', s => `${B}/stable/price-target-consensus?symbol=${s}`],
  ['grades-consensus', s => `${B}/stable/grades-consensus?symbol=${s}`],
  ['profile', s => `${B}/stable/profile?symbol=${s}`],
  ['v3-estimates', s => `${B}/api/v3/analyst-estimates/${s}?limit=4`],
];
(async () => {
  const out = { keySet: KEY.length > 0, results: [] };
  for (const s of ['AAPL', 'NVDA', 'SOUN', 'ASML', 'IREN']) for (const [name, u] of eps) {
    try {
      const url = u(s) + (u(s).includes('?') ? '&' : '?') + 'apikey=' + KEY;
      const r = await fetch(url); const t = await r.text();
      out.results.push({ symbol: s, endpoint: name, status: r.status, body: t.slice(0, 900).split(KEY).join('***') });
    } catch (e) { out.results.push({ symbol: s, endpoint: name, error: e.message }); }
    await new Promise(r => setTimeout(r, 300));
  }
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync('data/fmp_probe.json', JSON.stringify(out, null, 1));
  console.log(out.results.map(x => `${x.symbol} ${x.endpoint} ${x.status}`).join('\n'));
})();
