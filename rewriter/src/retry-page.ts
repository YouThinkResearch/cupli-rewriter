// Shown instead of a raw 502 when every upstream attempt failed on a page
// navigation. Auto-retries the same URL as a GET with exponential backoff —
// for a failed POST the form body is already stored, so the follow-up GET
// resubmits it via the session-reinstatement path. Served with status 200 so
// no CDN along the way replaces the body with its own error page.
export function renderRetryPage(): string {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Соединение прерывается…</title>
<noscript><meta http-equiv="refresh" content="5"></noscript>
<style>
  body { font: 16px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f5f6f8; color: #1c1e21; }
  .card { background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,.08); padding: 32px 36px; max-width: 380px; text-align: center; }
  .spinner { width: 36px; height: 36px; margin: 0 auto 16px; border: 3px solid #e4e6eb; border-top-color: #4a76d0; border-radius: 50%; animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p { margin: 0 0 4px; color: #65676b; font-size: 14px; }
  button { display: none; margin: 16px auto 0; padding: 10px 24px; font-size: 15px; border: 0; border-radius: 8px; background: #4a76d0; color: #fff; cursor: pointer; }
</style>
</head>
<body>
<div class="card">
  <div class="spinner" id="spinner"></div>
  <h1>Восстанавливаем соединение…</h1>
  <p id="msg">Опрос сейчас недоступен, пробуем ещё раз.</p>
  <p id="countdown"></p>
  <button id="retryBtn" onclick="doRetry()">Повторить попытку</button>
</div>
<script>
(function () {
  var key = 'rw_retry:' + location.pathname
  var MAX_AUTO = 5
  var attempt = 0
  try {
    var saved = JSON.parse(sessionStorage.getItem(key) || '{}')
    // counter only survives JS-free success pages 10 min, then resets
    if (saved.at && Date.now() - saved.at < 600000) attempt = saved.n || 0
  } catch (e) {}

  window.doRetry = function () {
    sessionStorage.setItem(key, JSON.stringify({ n: attempt + 1, at: Date.now() }))
    // always navigate as GET: a stored submission is resent server-side
    location.replace(location.pathname + location.search)
  }

  if (attempt >= MAX_AUTO) {
    sessionStorage.removeItem(key)
    document.getElementById('spinner').style.display = 'none'
    document.getElementById('retryBtn').style.display = 'block'
    document.getElementById('msg').textContent = 'Не получилось восстановить соединение автоматически.'
    return
  }

  var delay = Math.min(2000 * Math.pow(2, attempt), 30000)
  var left = Math.round(delay / 1000)
  var cd = document.getElementById('countdown')
  cd.textContent = 'Повторная попытка через ' + left + ' с'
  var timer = setInterval(function () {
    left -= 1
    if (left <= 0) { clearInterval(timer); doRetry(); return }
    cd.textContent = 'Повторная попытка через ' + left + ' с'
  }, 1000)
})()
</script>
</body>
</html>`
}
