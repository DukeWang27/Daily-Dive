// Saves the social preview image for each name: node tools/og.cjs  ->  og/<key>.png (1200 x 630)
const { chromium, serve } = require('../tests/lib.cjs');
const KEYS = (process.argv[2] || 'iceberg,nerodeep,meteordeep,fathomfive,trieste,sirenadeep').split(',');
(async () => {
  const site = serve(8827), b = await chromium.launch(), p = await (await b.newContext({ viewport: { width: 1200, height: 630 } })).newPage();
  for (const k of KEYS) { await p.goto(`http://localhost:8827/tools/og.html?brand=${k}`); await p.waitForSelector('body[data-ready]'); await p.locator('#og').screenshot({ path: `${__dirname}/../og/${k}.png` }); console.log('og/' + k + '.png'); }
  await b.close(); site.close();
})();
