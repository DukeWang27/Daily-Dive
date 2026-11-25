// Writes the tab and home-screen icons from brand.js: favicon.svg (browsers, search engines) and apple-touch-icon.png
// (iPhone and iPad home screens, 180 x 180). Run after changing the brand: node tools/icons.cjs
const { chromium, serve } = require('../tests/lib.cjs'); const fs = require('fs'), path = require('path');
(async () => {
  const site = serve(8828), b = await chromium.launch(), p = await (await b.newContext({ viewport: { width: 180, height: 180 } })).newPage();
  await p.goto('http://localhost:8828/privacy.html');
  const svg = await p.evaluate(() => Brand.iconSvg(Brand, 64).replace(/ width="64" height="64"/, ''));
  fs.writeFileSync(path.join(__dirname, '..', 'favicon.svg'), svg + '\n');
  // A home-screen icon is masked by the phone itself, so it fills the square with no rounded corners of its own.
  const square = svg.replace('rx="5"', 'rx="0"');
  await p.setContent(`<style>html,body{margin:0;background:#071433}</style>${square.replace('<svg ', '<svg width="180" height="180" ')}`);
  await p.screenshot({ path: path.join(__dirname, '..', 'apple-touch-icon.png'), clip: { x: 0, y: 0, width: 180, height: 180 } });
  console.log('favicon.svg, apple-touch-icon.png'); await b.close(); site.close();
})();
