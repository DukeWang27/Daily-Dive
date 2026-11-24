// A local stand-in for Supabase's web service, for tests only. It is NOT part of the game and proves nothing about
// Supabase's own sign-in system. What it does: accepts the same web requests the game sends to Supabase and runs
// them against a local PostgreSQL database that has the game's real tables, rules and functions loaded
// (tests/db/setup.sh). So the database rules are tested for real; the sign-in service is imitated.
//   node tests/gateway.cjs [port]            (default 8790)
const http = require('http'), crypto = require('crypto'), { Pool } = require('./node_modules/pg');
const DELAY = +(process.env.GATEWAY_DELAY || 0);
const SECRET = 'local-test-secret', DB = process.env.ICEBERG_TEST_DB || 'icetest';
const pool = new Pool({ host: '/var/run/postgresql', user: 'postgres', database: DB, max: 8 });
const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const sign = claims => { const body = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64(claims); return body + '.' + crypto.createHmac('sha256', SECRET).update(body).digest('base64url'); };
const verify = token => { const [h, p, s] = String(token || '').split('.'); if (!s || crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest('base64url') !== s) return null; const c = JSON.parse(Buffer.from(p, 'base64url')); return c.exp && c.exp < Date.now() / 1000 ? null : c; };
const ANON = sign({ role: 'anon', iss: 'local-test' });
const hash = pw => crypto.createHash('sha256').update('salt:' + pw).digest('hex');
const refresh = new Map(), sent = [];            // refresh tokens; "emails" that would have been sent
const userJson = u => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: u.created_at, app_metadata: { provider: u.raw_user_meta_data.provider || 'email', providers: [u.raw_user_meta_data.provider || 'email'] }, user_metadata: {}, identities: [], created_at: u.created_at, updated_at: u.created_at });
const session = u => { const now = Math.floor(Date.now() / 1000), rt = crypto.randomBytes(12).toString('hex'); refresh.set(rt, u.id);
  return { access_token: sign({ sub: u.id, role: 'authenticated', aud: 'authenticated', email: u.email, iat: now, exp: now + 3600, session_id: crypto.randomUUID() }), token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: rt, user: userJson(u) }; };

// Run one statement the way Supabase would: as the public role, with the caller's identity attached.
async function run(claims, sql, params = []) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims || { role: 'anon' })]);
    await c.query(`set local role ${claims && claims.role === 'authenticated' ? 'authenticated' : 'anon'}`);
    const r = await c.query(sql, params); await c.query('commit'); return r.rows;
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
}
const admin = (sql, p) => pool.query(sql, p).then(r => r.rows);
const ident = s => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error('bad name'); return s; };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), send = (code, body, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': '*', ...headers }); res.end(body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body)); };
  if (req.method === 'OPTIONS') return send(204);
  let raw = ''; for await (const chunk of req) raw += chunk;
  let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch { /* not JSON */ }
  const bearer = (req.headers.authorization || '').replace(/^Bearer /, ''), claims = verify(bearer), p = url.pathname;
  if (DELAY && !p.startsWith('/__')) await new Promise(r => setTimeout(r, DELAY));   // GATEWAY_DELAY=ms: a slow server, for timing tests
  try {
    if (!verify(req.headers.apikey) && p !== '/auth/v1/authorize' && !p.startsWith('/__')) return send(401, { message: 'Invalid API key' });
    // ----- sign-in (imitated) -----
    if (p === '/auth/v1/signup') {
      const email = String(body.email || '').toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send(422, { code: 422, error_code: 'validation_failed', msg: 'Unable to validate email address: invalid format' });
      if (String(body.password || '').length < 6) return send(422, { code: 422, error_code: 'weak_password', msg: 'Password should be at least 6 characters.' });
      if ((await admin(`select 1 from auth.users where email = $1`, [email])).length) return send(422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
      const [u] = await admin(`insert into auth.users (email, encrypted_password) values ($1, $2) returning *`, [email, hash(body.password)]);
      if (/@confirm\./.test(email)) { sent.push({ to: email, kind: 'confirm' }); return send(200, { ...userJson(u), email_confirmed_at: null, confirmation_sent_at: u.created_at, identities: [{ id: u.id, user_id: u.id, provider: 'email', identity_data: { email } }] }); }   // a project with "confirm email" on
      return send(200, session(u));
    }
    if (p === '/auth/v1/resend') { sent.push({ to: String(body.email || '').toLowerCase(), kind: 'confirm-again' }); return send(200, {}); }   // always quiet: never says whether the address exists
    if (p === '/auth/v1/token') {
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const [u] = await admin(`select * from auth.users where email = $1 and encrypted_password = $2`, [String(body.email || '').toLowerCase(), hash(body.password || '')]);
        return u ? send(200, session(u)) : send(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      }
      if (grant === 'refresh_token') {
        const id = refresh.get(body.refresh_token), [u] = id ? await admin(`select * from auth.users where id = $1`, [id]) : [];
        if (!u) return send(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' });
        refresh.delete(body.refresh_token); return send(200, session(u));
      }
      return send(400, { msg: 'unsupported grant' });
    }
    if (p === '/auth/v1/user') {
      const [u] = claims && claims.sub ? await admin(`select * from auth.users where id = $1`, [claims.sub]) : [];
      if (!u) return send(401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
      if (req.method === 'PUT' && body.password) { if (String(body.password).length < 6) return send(422, { code: 422, error_code: 'weak_password', msg: 'Password should be at least 6 characters.' }); await admin(`update auth.users set encrypted_password = $2 where id = $1`, [u.id, hash(body.password)]); }
      return send(200, userJson(u));
    }
    if (p === '/auth/v1/logout') return send(204);
    if (p === '/auth/v1/recover') { sent.push({ to: String(body.email || '').toLowerCase(), kind: 'recover' }); return send(200, {}); }
    if (p === '/auth/v1/authorize') {      // "Continue with Google": pretend Google said yes, and come straight back
      const email = 'google.user@example.test';
      let [u] = await admin(`select * from auth.users where email = $1`, [email]);
      if (!u) [u] = await admin(`insert into auth.users (email, raw_user_meta_data) values ($1, '{"provider":"google"}') returning *`, [email]);
      const s = session(u), back = url.searchParams.get('redirect_to') || '/';
      return send(302, '', { Location: `${back.split('#')[0]}#access_token=${s.access_token}&expires_at=${s.expires_at}&expires_in=3600&refresh_token=${s.refresh_token}&token_type=bearer&type=signin` });
    }
    // ----- database functions and tables -----
    let m;
    if ((m = p.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/))) {
      const keys = Object.keys(body).map(ident);
      const rows = await run(claims, `select public.${ident(m[1])}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as v`, keys.map(k => body[k] !== null && typeof body[k] === 'object' ? JSON.stringify(body[k]) : body[k]));
      return send(200, JSON.stringify(rows[0].v));
    }
    if ((m = p.match(/^\/rest\/v1\/([a-z_]+)$/))) {
      const t = ident(m[1]);
      if (req.method === 'POST') { const keys = Object.keys(body).map(ident); await run(claims, `insert into public.${t} (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, keys.map(k => body[k])); return send(201); }
      const where = [], vals = [];
      for (const [k, v] of url.searchParams) { if (k === 'select' || k === 'limit' || k === 'order') continue; const e = String(v).match(/^eq\.(.*)$/); if (e) { vals.push(e[1]); where.push(`${ident(k)}::text = $${vals.length}`); } }
      return send(200, await run(claims, `select * from public.${t}${where.length ? ' where ' + where.join(' and ') : ''} limit 1000`, vals));
    }
    // ----- test controls (not something Supabase has) -----
    if (p === '/__test/key') return send(200, { anonKey: ANON });
    if (p === '/__test/sql') return send(200, await admin(body.sql, body.params || []));
    if (p === '/__test/mail') return send(200, sent);
    return send(404, { message: 'not found' });
  } catch (e) {
    const denied = /permission denied/.test(e.message);
    send(denied ? (claims ? 403 : 401) : 400, { code: e.code || 'P0001', message: e.message, details: null, hint: null });
  }
});
const port = +process.argv[2] || 8790;
if (require.main === module) server.listen(port, () => console.log('test gateway on http://localhost:' + port));
module.exports = { server, ANON, pool, port };
