const { fetch, EnvHttpProxyAgent } = require('undici');
const dispatcher = process.env.HTTPS_PROXY || process.env.HTTP_PROXY ? new EnvHttpProxyAgent() : undefined;
class SearchError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
function parseFilters(input) {
  const read = (key, max = 150) => {
    const value = input[key] ?? '';
    if (typeof value !== 'string' || value.length > max) throw new SearchError(`Некорректный параметр: ${key}`);
    return value.trim();
  };
  const text = read('text'), salary = read('salary', 10), area = read('area', 12), company = read('company');
  const tax = read('tax'), experience = read('experience'), remote = read('remote');
  const currency = read('currency') || 'RUR';
  const page = read('page', 4) || '0';
  if (salary && (!/^\d+$/.test(salary) || +salary < 1 || +salary > 100000000)) throw new SearchError('Укажите корректную зарплату.');
  if (area && !/^\d+$/.test(area)) throw new SearchError('Выберите регион из списка.');
  if (!['', 'net', 'gross'].includes(tax)) throw new SearchError('Некорректный тип зарплаты.');
  if (!['', 'noExperience', 'between1And3', 'between3And6', 'moreThan6'].includes(experience)) throw new SearchError('Некорректный опыт.');
  if (!['RUR', 'USD', 'EUR', 'KZT', 'BYR'].includes(currency)) throw new SearchError('Некорректная валюта.');
  if (!/^\d+$/.test(page) || +page > 99) throw new SearchError('Некорректная страница.');
  if (!['', 'true'].includes(remote)) throw new SearchError('Некорректный формат работы.');
  return { text, salary, area, company, tax, experience, remote, currency, page: +page };
}
function hhParams(filters) {
  const q = new URLSearchParams({ page: String(filters.page), per_page: '20', order_by: 'publication_time' });
  // Separate search fields prevent employer names from matching vacancy descriptions.
  const quote = value => '"' + value.replace(/["\\]/g, ' ').trim() + '"';
  const terms = [];
  if (filters.text) terms.push(`NAME:(${quote(filters.text)})`);
  if (filters.company) terms.push(`COMPANY_NAME:(${quote(filters.company)})`);
  if (terms.length) q.set('text', terms.join(' AND '));
  for (const name of ['salary', 'area', 'experience']) if (filters[name]) q.set(name, filters[name]);
  if (filters.salary) { q.set('currency', filters.currency); q.set('only_with_salary', 'true'); }
  if (filters.remote) q.set('work_format', 'REMOTE');
  return q;
}
async function hhRequest(endpoint, request = fetch) {
  let response;
  try {
    response = await request(`https://api.hh.ru${endpoint}`, {
      headers: { 'User-Agent': process.env.HH_USER_AGENT || 'FindYourJob/1.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(12000), ...(dispatcher ? { dispatcher } : {})
    });
  } catch { throw new SearchError('Не удалось связаться с hh.ru. Попробуйте позже.', 502); }
  if (!response.ok) throw new SearchError(response.status === 429 ? 'hh.ru временно ограничил запросы. Попробуйте через минуту.' : 'hh.ru временно недоступен. Попробуйте позже.', response.status === 429 ? 429 : 502);
  return response.json();
}
function clean(value) { return typeof value === 'string' ? value.replace(/<[^>]*>/g, '') : ''; }
function safeLink(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && (u.hostname === 'hh.ru' || u.hostname.endsWith('.hh.ru')) ? u.href : null; } catch { return null; }
}
async function searchVacancies(input, request) {
  const filters = parseFilters(input);
  const raw = await hhRequest(`/vacancies?${hhParams(filters)}`, request);
  const vacancies = (raw.items || []).filter(v => !filters.tax || (v.salary && v.salary.gross === (filters.tax === 'gross'))).map(v => ({
    id: v.id, title: clean(v.name), url: safeLink(v.alternate_url),
    company: clean(v.employer?.name), area: clean(v.area?.name),
    salary: v.salary ? { from: v.salary.from, to: v.salary.to, currency: v.salary.currency, gross: v.salary.gross } : null,
    requirement: clean(v.snippet?.requirement), responsibility: clean(v.snippet?.responsibility),
    experience: clean(v.experience?.name), publishedAt: v.published_at
  }));
  return { vacancies, found: raw.found, page: raw.page, pages: raw.pages, taxFiltered: !!filters.tax };
}
let areasCache;
async function getAreas(request) {
  if (areasCache && areasCache.expires > Date.now()) return areasCache.data;
  const tree = await hhRequest('/areas', request);
  const data = [];
  function flatten(nodes, parent = '') {
    for (const n of nodes) {
      data.push({ id: n.id, name: n.name, label: parent ? `${n.name} · ${parent}` : n.name });
      flatten(n.areas || [], n.name);
    }
  }
  flatten(tree);
  areasCache = { data, expires: Date.now() + 86400000 };
  return data;
}
module.exports = { SearchError, parseFilters, hhParams, searchVacancies, getAreas };
