const { chromium } = require('@playwright/test');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { once } = require('node:events');
const assert = require('node:assert/strict');
(async () => {
  const db = await openDatabase(null, 'memory://');
  const app = createApp(db, { hhFetch: async url => new Response(JSON.stringify(url.includes('/areas') ? [{ id: '1', name: 'Москва', areas: [] }] : { found: 1, page: 0, pages: 1, items: [{ id: '123', name: 'Python-разработчик', alternate_url: 'https://hh.ru/vacancy/123', employer: { name: 'Тестовая компания' }, area: { name: 'Москва' }, salary: { from: 180000, to: 250000, currency: 'RUR', gross: false }, experience: { name: 'От 1 года до 3 лет' }, snippet: { requirement: '<highlighttext>Python</highlighttext>, SQL, опыт разработки API', responsibility: 'Разработка сервисов и работа с данными.' }, published_at: new Date().toISOString() }] })) });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = []; page.on('pageerror', err => errors.push(err.message));
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(base); await page.screenshot({ path: '/tmp/fyj-desktop.png', fullPage: true });
    await page.getByRole('link', { name: 'Создать аккаунт' }).click();
    await page.getByLabel('Ваше имя').fill('Анна'); await page.getByLabel('Email').fill('anna@example.com'); await page.getByLabel('Пароль', { exact: true }).fill('Password12345');
    await page.getByRole('button', { name: 'Зарегистрироваться' }).click(); await page.waitForURL(base + '/');
    await page.getByText('Анна', { exact: true }).waitFor();
    await page.getByLabel('Профессия или должность').fill('Python');
    await page.getByLabel('Расположение', { exact: true }).fill('Моск');
    await page.getByRole('option', { name: 'Москва' }).click();
    await page.getByLabel('Как указана зарплата').selectOption('net');
    await page.getByRole('button', { name: 'Найти работу' }).click();
    await page.getByRole('heading', { name: 'Python-разработчик' }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Подробнее на hh.ru' }).getAttribute('href'), 'https://hh.ru/vacancy/123');
    await page.screenshot({ path: '/tmp/fyj-results.png', fullPage: true });
    await page.getByRole('button', { name: 'Выйти' }).click(); await page.getByRole('link', { name: 'Войти', exact: true }).waitFor();
    await page.getByRole('link', { name: 'Войти', exact: true }).click(); await page.getByLabel('Email').fill('anna@example.com'); await page.getByLabel('Пароль').fill('incorrect'); await page.getByRole('button', { name: 'Войти' }).click();
    await page.getByText('Неверный email или пароль.').waitFor();
    await page.getByLabel('Пароль').fill('Password12345'); await page.getByRole('button', { name: 'Войти' }).click(); await page.waitForURL(base + '/'); await page.getByText('Анна', { exact: true }).waitFor();
    await page.route('**/api/vacancies?**', route => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'hh.ru временно недоступен.' }) }));
    await page.getByRole('button', { name: 'Найти работу' }).click(); await page.getByText(/hh.ru временно недоступен/).waitFor();
    for (const path of ['/', '/login.html', '/register.html']) {
      await page.setViewportSize({ width: 390, height: 844 }); await page.goto(base + path);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Mobile overflow: ${path}`);
    }
    await page.goto(base); await page.screenshot({ path: '/tmp/fyj-mobile.png', fullPage: true });
    assert.deepEqual(errors, []); console.log('Browser checks passed: registration, login, logout, search, errors, mobile pages.');
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); await db.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
