const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const types = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.html': 'text/html; charset=utf-8' };
function serve(port) {
  return http.createServer((q, r) => { let u = decodeURIComponent(q.url.split('?')[0]); if (u === '/') u = '/index.html'; const f = path.join(root, u);
    fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); }); }).listen(port);
}
const VPS = { desk: { width: 1280, height: 820 }, phone: { width: 390, height: 844 }, small: { width: 360, height: 640 }, tablet: { width: 820, height: 1180 }, wide: { width: 1680, height: 1000 } };
async function open(browser, vp, url, opts = {}) {
  const ctx = await browser.newContext({ viewport: VPS[vp], deviceScaleFactor: opts.dpr || 1, hasTouch: vp === 'phone' || vp === 'small', ...(opts.ctx || {}) });
  const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', e => p.errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') p.errs.push('console: ' + m.text()); });
  await p.goto(url); await p.waitForSelector('#play');
  return p;
}
// Layout audit: horizontal scroll, text clipped inside its box (unless it's an intentional ellipsis), visible elements off-screen.
async function audit(p, scope = 'main, header') {
  return p.evaluate(sel => {
    const issues = [], vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw + 1) issues.push('horizontal scroll: ' + document.documentElement.scrollWidth + ' > ' + vw);
    for (const root of document.querySelectorAll(sel)) for (const n of root.querySelectorAll('*')) {
      if (n.closest('[hidden]') || n.matches('.ib-glow, .ib-shade, .sr') || n.closest('svg') || n.closest('.ib-world') || n.closest('.scene') || n.closest('.cal-wrap') || n.tagName === 'CANVAS') continue;   // (.cal-wrap scrolls sideways on purpose)
      const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      const r = n.getBoundingClientRect(); if (!r.width || !r.height) continue;
      if (r.right > vw + 1 || r.left < -1) issues.push(`off-screen: ${n.tagName}.${n.className} ${Math.round(r.left)}..${Math.round(r.right)}`);
      const ell = cs.textOverflow === 'ellipsis';
      if (!ell && n.children.length === 0 && n.textContent.trim() && n.scrollWidth > n.clientWidth + 1 && cs.overflowX !== 'visible') issues.push(`clipped text: ${n.tagName}.${n.className} "${n.textContent.trim().slice(0, 30)}"`);
    }
    return issues;
  }, scope);
}
module.exports = { chromium, serve, open, audit, VPS };
