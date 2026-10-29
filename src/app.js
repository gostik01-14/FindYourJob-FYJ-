const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const { hashPassword, verifyPassword, digest, cookieToken } = require('./auth');
const { SearchError, searchVacancies, getAreas } = require('./hh');

function createApp(db, options = {}) {
  const app = express();
  const production = process.env.NODE_ENV === 'production';
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { 'script-src': ["'self'"], 'style-src': ["'self'"], 'img-src': ["'self'", 'data:'] } } }));
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      const origin = req.get('origin');
      const expected = process.env.APP_ORIGIN || `${req.protocol}://${req.get('host')}`;
      if ((origin && origin !== expected) || req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'Запрос с другого сайта запрещён.' });
      if (!req.is('application/json')) return res.status(415).json({ error: 'Ожидается JSON.' });
    }
    next();
  });
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Слишком много попыток входа. Попробуйте через 15 минут.' } });
  const searchLimiter = rateLimit({ windowMs: 60000, limit: 40, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Слишком много запросов. Подождите минуту.' } });
  const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: production, path: '/' };
  async function session(req, res, user) {
    const token = randomBytes(32).toString('hex');
    // Rotate any previous session on successful authentication.
    if (cookieToken(req)) await db.query('DELETE FROM sessions WHERE token_hash = $1', [digest(cookieToken(req))]);
    await db.query('DELETE FROM sessions WHERE expires_at < NOW()');
    await db.query("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '7 days')", [digest(token), user.id]);
    res.cookie('fyj_session', token, { ...cookieOptions, maxAge: 7 * 86400000 });
    res.json({ user: { id: user.id, name: user.name, email: user.email } });
  }
  const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  app.post('/api/auth/register', authLimiter, async (req, res) => {
    const { name, email, password } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80 || !validEmail(email) || typeof password !== 'string' || password.length < 10 || password.length > 128) {
      return res.status(400).json({ error: 'Укажите имя, корректный email и пароль от 10 до 128 символов.' });
    }
    const passwordHash = await hashPassword(password);
    let result;
    try {
      result = await db.query('INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email', [name.trim(), email.trim().toLowerCase(), passwordHash]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Этот email уже зарегистрирован.' });
      throw err;
    }
    res.status(201);
    await session(req, res, result.rows[0]);
  });
  // A precomputed dummy hash keeps unknown-account logins on the same hashing path.
  const dummyHash = hashPassword(randomBytes(24).toString('hex'));
  app.post('/api/auth/login', authLimiter, async (req, res) => {
    const { email, password } = req.body || {};
    if (!validEmail(email) || typeof password !== 'string' || password.length > 128) return res.status(400).json({ error: 'Укажите email и пароль.' });
    const { rows } = await db.query('SELECT id,name,email,password_hash FROM users WHERE email=$1', [email.trim().toLowerCase()]);
    const valid = await verifyPassword(password, rows[0]?.password_hash || await dummyHash);
    if (!rows[0] || !valid) return res.status(401).json({ error: 'Неверный email или пароль.' });
    await session(req, res, rows[0]);
  });
  app.get('/api/auth/me', async (req, res) => {
    const { rows } = await db.query('SELECT u.id,u.name,u.email FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW()', [digest(cookieToken(req))]);
    res.json({ user: rows[0] || null });
  });
  app.post('/api/auth/logout', async (req, res) => {
    await db.query('DELETE FROM sessions WHERE token_hash=$1', [digest(cookieToken(req))]);
    res.clearCookie('fyj_session', cookieOptions).json({ ok: true });
  });
  app.get('/api/areas', searchLimiter, async (req, res) => res.json({ areas: await getAreas(options.hhFetch) }));
  app.get('/api/vacancies', searchLimiter, async (req, res) => res.json(await searchVacancies(req.query, options.hhFetch)));
  app.get('/api/health', async (req, res) => { await db.query('SELECT 1'); res.json({ ok: true }); });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Маршрут не найден.' }));
  app.use(express.static(path.join(__dirname, '../public'), { extensions: ['html'] }));
  app.use((req, res) => res.status(404).send('Страница не найдена'));
  app.use((err, req, res, next) => {
    if (err instanceof SearchError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Некорректный JSON.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Слишком большой запрос.' });
    console.error('Request failed:', err.code || err.name);
    res.status(500).json({ error: 'Внутренняя ошибка. Попробуйте позже.' });
  });
  return app;
}
module.exports = { createApp };
