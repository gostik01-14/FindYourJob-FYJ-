const form = document.getElementById('auth-form');
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button[type=submit]');
  const error = document.getElementById('auth-error');
  button.disabled = true; error.textContent = '';
  try {
    const response = await fetch(`/api/auth/${form.dataset.mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос.');
    location.assign('/');
  } catch (err) { error.textContent = err.message || 'Нет соединения с сервером.'; }
  finally { button.disabled = false; }
});
