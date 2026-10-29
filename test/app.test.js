const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { parseFilters, hhParams, searchVacancies } = require('../src/hh');
let db, server, base, cookie;
const calls = [];
const mockHH = async url => {
  calls.push(new URL(url));
  return new Response(JSON.stringify(url.includes('/areas') ? [{ id: '1', name: 'Москва', areas: [] }] : {
    found: 2, page: 0, pages: 1, items: [
      { id: '1', name: 'Разработчик', alternate_url: 'https://hh.ru/vacancy/1', employer: { name: 'Компания' }, area: { name: 'Москва' }, salary: { from: 150000, to: null, currency: 'RUR', gross: false }, snippet: { requirement: '<highlighttext>JavaScript</highlighttext>' }, published_at: '2026-10-29T12:00:00+03:00' },
      { id: '2', name: 'Дизайнер', alternate_url: 'javascript:alert(1)', salary: { from: 200000, currency: 'RUR', gross: true } }
    ]
  }), { status: 200 });
};
before(async () => {
  db = await openDatabase(process.env.TEST_DATABASE_URL, 'memory://');
  server = createApp(db, { hhFetch: mockHH }).listen(0, '127.0.0.1');
  await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); await db.close(); });
async function post(route, body, session = cookie, extra = {}) {
  return fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(session ? { Cookie: session } : {}), ...extra }, body: JSON.stringify(body) });
}
test('register, persist hashed password, restore session, logout and login', async () => {
  const response = await post('/api/auth/register', { name: 'Анна', email: 'ANNA@example.com', password: 'StrongPassword123' });
  assert.equal(response.status, 201); cookie = response.headers.get('set-cookie').split(';')[0];
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await response.json()).user.name, 'Анна');
  const row = (await db.query('SELECT * FROM users')).rows[0];
  assert.notEqual(row.password_hash, 'StrongPassword123'); assert.equal(row.email, 'anna@example.com');
  assert.equal((await (await fetch(base + '/api/auth/me', { headers: { Cookie: cookie } })).json()).user.name, 'Анна');
  assert.equal((await post('/api/auth/register', { name: 'Анна', email: 'anna@example.com', password: 'StrongPassword123' })).status, 409);
  assert.equal((await post('/api/auth/login', { email: 'anna@example.com', password: 'wrong' })).status, 401);
  const old = cookie;
  const login = await post('/api/auth/login', { email: 'anna@example.com', password: 'StrongPassword123' });
  assert.equal(login.status, 200); cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await (await fetch(base + '/api/auth/me', { headers: { Cookie: old } })).json()).user, null);
  assert.equal((await post('/api/auth/logout', {})).status, 200);
  assert.equal((await (await fetch(base + '/api/auth/me', { headers: { Cookie: cookie } })).json()).user, null);
});
test('expired sessions cannot authenticate', async () => {
  const r = await post('/api/auth/login', { email: 'anna@example.com', password: 'StrongPassword123' });
  const token = r.headers.get('set-cookie').split(';')[0];
  await db.query("UPDATE sessions SET expires_at = NOW() - INTERVAL '1 day'");
  assert.equal((await (await fetch(base + '/api/auth/me', { headers: { Cookie: token } })).json()).user, null);
});
test('validation and CSRF reject invalid requests', async () => {
  assert.equal((await post('/api/auth/register', { name: 'A', email: 'bad', password: 'short' })).status, 400);
  assert.equal((await post('/api/auth/logout', {}, null, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await fetch(base + '/api/auth/logout', { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await post('/api/auth/login', { email: "'OR'1'='1@mail.com", password: 'StrongPassword123' })).status, 401);
});
test('search forwards filters, returns clean cards, and filters tax without guessing', async () => {
  const r = await fetch(base + '/api/vacancies?text=Разработчик&company=Компания&area=1&salary=100000&tax=net&remote=true&experience=between1And3');
  assert.equal(r.status, 200);
  const data = await r.json(); assert.equal(data.vacancies.length, 1); assert.equal(data.found, 2); assert.equal(data.taxFiltered, true);
  assert.equal(data.vacancies[0].requirement, 'JavaScript');
  const params = calls.at(-1).searchParams;
  assert.equal(params.get('area'), '1'); assert.equal(params.get('salary'), '100000'); assert.equal(params.get('work_format'), 'REMOTE');
  assert.match(params.get('text'), /COMPANY_NAME/);
  const all = await searchVacancies({}, mockHH); assert.equal(all.vacancies[1].url, null);
  const areas = await (await fetch(base + '/api/areas')).json(); assert.equal(areas.areas[0].name, 'Москва');
});
test('bad filters cannot trigger upstream calls', async () => {
  const before = calls.length;
  for (const query of ['salary=-10', 'page=100', 'tax=bad', 'area=Москва', 'experience=bad', 'text=a&text=b']) assert.equal((await fetch(base + '/api/vacancies?' + query)).status, 400);
  assert.equal(calls.length, before);
});
test('upstream timeout, rate limiting and permission errors are surfaced', async () => {
  await assert.rejects(searchVacancies({}, async () => { throw Error('timeout'); }), { status: 502 });
  await assert.rejects(searchVacancies({}, async () => new Response('', { status: 429 })), { status: 429 });
  await assert.rejects(searchVacancies({}, async () => new Response('', { status: 403 })), { status: 502 });
});
test('search operators cannot be injected through user text', () => {
  const params = hhParams(parseFilters({ text: 'dev" OR NAME:("admin', company: 'A\\B' }));
  assert.equal(params.get('text'), 'NAME:("dev  OR NAME:( admin") AND COMPANY_NAME:("A B")');
});
test('pages and security headers are served', async () => {
  for (const page of ['/', '/login.html', '/register.html']) {
    const r = await fetch(base + page); assert.equal(r.status, 200); assert.match(r.headers.get('content-security-policy'), /script-src 'self'/); assert.match(await r.text(), /lang="ru"/);
  }
  assert.equal((await (await fetch(base + '/api/health')).json()).ok, true);
});
