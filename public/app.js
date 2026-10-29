function addArrow(el) { const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('class', 'arrow-icon'); icon.setAttribute('aria-hidden', 'true'); const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'M5 19 19 5M5 5h14v14'); icon.append(path); el.append(icon); }
const $ = id => document.getElementById(id);
const form = $('search-form');
let page = 0, pages = 0, searching = false, selectedQuery, areas = [], areasLoaded = false;
async function api(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос.');
  return data;
}
function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}
async function account() {
  try {
    const { user } = await api('/api/auth/me');
    if (!user) return;
    const label = element('span', 'user-name', user.name);
    const logout = element('button', 'button button-secondary button-small', 'Выйти');
    logout.addEventListener('click', async () => {
      logout.disabled = true;
      try { await api('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); location.reload(); }
      catch (err) { $('status').textContent = err.message; logout.disabled = false; }
    });
    $('account').replaceChildren(label, logout);
  } catch { $('status').textContent = 'Не удалось проверить аккаунт. Обновите страницу.'; }
}
function formatSalary(salary) {
  if (!salary) return 'Зарплата не указана';
  const number = value => Number(value).toLocaleString('ru-RU');
  const currency = { RUR: '₽', USD: '$', EUR: '€', KZT: '₸', BYR: 'BYN' }[salary.currency] || salary.currency;
  let range = salary.from && salary.to ? `${number(salary.from)} – ${number(salary.to)}` : salary.from ? `от ${number(salary.from)}` : salary.to ? `до ${number(salary.to)}` : 'По договорённости';
  return `${range} ${currency} · ${salary.gross === true ? 'до вычета налогов' : salary.gross === false ? 'на руки' : 'налоги не уточнены'}`;
}
function renderVacancy(v) {
  const card = element('article', 'vacancy-card');
  const meta = element('div', 'vacancy-meta');
  meta.append(element('span', 'company-avatar', (v.company || 'HH').slice(0, 2).toUpperCase()), element('span', 'company-name', v.company));
  const date = new Date(v.publishedAt);
  if (!Number.isNaN(+date)) meta.append(element('time', 'vacancy-date', date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })));
  const heading = element('h3');
  if (v.url) {
    const link = element('a', '', v.title); link.href = v.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; heading.append(link);
  } else heading.textContent = v.title;
  const tags = element('div', 'vacancy-tags');
  for (const text of [v.area, v.experience]) if (text) tags.append(element('span', '', text));
  card.append(meta, heading, element('p', 'salary', formatSalary(v.salary)), tags);
  if (v.requirement) card.append(element('p', 'snippet', v.requirement));
  if (v.responsibility) card.append(element('p', 'snippet', v.responsibility));
  if (v.url) { const link = element('a', 'vacancy-link', 'Подробнее на hh.ru '); addArrow(link); link.href = v.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link); }
  return card;
}
async function search(targetPage = 0) {
  if (searching) return;
  searching = true;
  form.querySelector('button[type=submit]').disabled = true;
  $('prev').disabled = $('next').disabled = true;
  $('status').textContent = 'Ищем подходящие вакансии на hh.ru…';
  $('status').className = 'loading-message';
  $('vacancies').setAttribute('aria-busy', 'true');
  const query = new URLSearchParams(targetPage === 0 ? new FormData(form) : selectedQuery);
  for (const [key, value] of [...query]) if (!value) query.delete(key);
  query.set('page', targetPage);
  try {
    const data = await api(`/api/vacancies?${query}`);
    selectedQuery = query; page = data.page; pages = Math.min(data.pages, 100);
    $('status').textContent = '';
    $('status').className = '';
    $('results-title').textContent = data.taxFiltered ? `На странице: ${data.vacancies.length} вакансий` : `Найдено вакансий: ${Number(data.found).toLocaleString('ru-RU')}`;
    $('results-note').textContent = data.taxFiltered ? `В hh.ru до фильтра по налогам: ${data.found}. Показываем совпадения на текущей странице; на следующих могут быть другие.` : 'Сначала новые · Данные hh.ru';
    if (data.vacancies.length) $('vacancies').replaceChildren(...data.vacancies.map(renderVacancy));
    else {
      const empty = element('div', 'empty-state');
      empty.append(element('div', 'empty-icon', '⌕'), element('h3', '', 'Совпадений пока нет'), element('p', '', data.taxFiltered && pages > page + 1 ? 'Попробуйте следующую страницу или измените условия зарплаты.' : 'Попробуйте расширить поиск: изменить профессию, регион или зарплату.'));
      $('vacancies').replaceChildren(empty);
    }
    $('pagination').hidden = pages <= 1;
    $('page-label').textContent = `Страница ${page + 1} из ${Math.max(pages, 1)}`;
  } catch (err) {
    $('status').className = 'error-message';
    $('status').textContent = err.message + ' Измените условия или повторите поиск.';
  } finally {
    searching = false;
    form.querySelector('button[type=submit]').disabled = false;
    $('prev').disabled = page <= 0;
    $('next').disabled = page + 1 >= pages;
    $('vacancies').removeAttribute('aria-busy');
  }
}
form.addEventListener('submit', e => { e.preventDefault(); search(0); });
$('prev').addEventListener('click', () => search(page - 1));
$('next').addEventListener('click', () => search(page + 1));
$('reset').addEventListener('click', () => { form.reset(); $('area').value = ''; $('area-hint').textContent = 'Не выбран — все регионы'; closeAreas(); });
for (const button of document.querySelectorAll('[data-query]')) button.addEventListener('click', () => { $('text').value = button.dataset.query; search(0); });
function closeAreas() { $('area-options').hidden = true; $('area-search').setAttribute('aria-expanded', 'false'); }
function showAreas() {
  const term = $('area-search').value.toLocaleLowerCase('ru');
  const matches = areas.filter(a => a.name.toLocaleLowerCase('ru').includes(term)).slice(0, 12);
  $('area-options').replaceChildren();
  for (const area of matches) {
    const button = element('button', 'area-option', area.label); button.type = 'button'; button.setAttribute('role', 'option');
    button.addEventListener('click', () => { $('area').value = area.id; $('area-search').value = area.name; $('area-hint').textContent = area.label; closeAreas(); });
    $('area-options').append(button);
  }
  $('area-options').hidden = matches.length === 0;
  $('area-search').setAttribute('aria-expanded', String(matches.length > 0));
}
async function loadAreas() {
  if (!areasLoaded) {
    $('area-hint').textContent = 'Загружаем регионы hh.ru…';
    try { ({ areas } = await api('/api/areas')); areasLoaded = true; $('area-hint').textContent = 'Выберите регион из списка'; }
    catch (err) { $('area-hint').textContent = err.message; return; }
  }
  showAreas();
}
$('area-search').addEventListener('focus', loadAreas);
$('area-search').addEventListener('input', () => { $('area').value = ''; $('area-hint').textContent = 'Выберите регион из списка или оставьте все регионы'; if (areasLoaded) showAreas(); });
$('area-search').addEventListener('keydown', e => { if (e.key === 'Escape') closeAreas(); if (e.key === 'ArrowDown') { e.preventDefault(); $('area-options').querySelector('button')?.focus(); } });
$('area-options').addEventListener('keydown', e => { if (e.key === 'ArrowDown') { e.preventDefault(); e.target.nextElementSibling?.focus(); } if (e.key === 'ArrowUp') { e.preventDefault(); (e.target.previousElementSibling || $('area-search')).focus(); } if (e.key === 'Escape') { closeAreas(); $('area-search').focus(); } });
document.addEventListener('click', e => { if (!$('area-options').contains(e.target) && e.target !== $('area-search')) closeAreas(); });
account();
