export interface RetryPageDetails {
  // short machine-ish reason, e.g. 'upstream TTFB timeout' or 'upstream status 502'
  reason: string
  attempts: number
  totalMs: number
  sessionId: string
  path: string
  // whether a form submission is stored server-side (i.e. nothing was lost)
  hasStoredSubmission: boolean
}

// Shown instead of a raw 502 when every upstream attempt failed on a page
// navigation. Auto-retries the same URL as a GET with exponential backoff —
// for a failed POST the form body is already stored, so the follow-up GET
// resubmits it via the session-reinstatement path. Served with status 200 so
// no CDN along the way replaces the body with its own error page.
export function renderRetryPage(details: RetryPageDetails): string {
  const now = new Date().toISOString()
  const dataSafety = details.hasStoredSubmission
    ? 'Ваши ответы сохранены на нашей стороне и будут отправлены автоматически при восстановлении связи — заново заполнять ничего не придётся.'
    : 'Ваш прогресс в опросе сохраняется на сервере опроса — при восстановлении связи вы продолжите с того же места.'

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
  .card { background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,.08); padding: 32px 36px; max-width: 440px; text-align: center; }
  .spinner { width: 36px; height: 36px; margin: 0 auto 16px; border: 3px solid #e4e6eb; border-top-color: #4a76d0; border-radius: 50%; animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p { margin: 0 0 10px; color: #65676b; font-size: 14px; text-align: left; }
  p.center { text-align: center; margin-bottom: 4px; }
  .safe { background: #eef7ee; border: 1px solid #cde8cd; border-radius: 8px; padding: 10px 12px; color: #2e6b30; }
  button { display: none; margin: 16px auto 0; padding: 10px 24px; font-size: 15px; border: 0; border-radius: 8px; background: #4a76d0; color: #fff; cursor: pointer; }
  details { margin-top: 16px; text-align: left; font-size: 12px; color: #8a8d91; }
  details summary { cursor: pointer; }
  details code { display: block; white-space: pre-wrap; word-break: break-all; background: #f5f6f8; border-radius: 6px; padding: 8px 10px; margin-top: 6px; font-size: 11px; }
</style>
</head>
<body>
<div class="card">
  <div class="spinner" id="spinner"></div>
  <h1>Восстанавливаем соединение…</h1>
  <p>Сервис опросов сейчас не отвечает — такое иногда случается на несколько секунд. Мы уже сделали ${details.attempts} попыт${details.attempts === 1 ? 'ку' : 'ки'} соединиться и продолжаем автоматически.</p>
  <p class="safe">${dataSafety}</p>
  <p>Можно ничего не делать — страница обновится сама. Также можно просто обновить страницу или открыть эту же ссылку позже: вы вернётесь к своему месту в опросе.</p>
  <p class="center" id="countdown"></p>
  <button id="retryBtn" onclick="doRetry()">Повторить попытку</button>
  <details>
    <summary>Технические детали</summary>
    <code>time: ${now}
reason: ${details.reason}
attempts: ${details.attempts} (${details.totalMs} ms)
path: ${details.path}
session: ${details.sessionId}
saved-form: ${details.hasStoredSubmission ? 'yes' : 'no (progress on survey server)'}</code>
  </details>
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
    document.getElementById('msg') && (document.getElementById('msg').textContent = '')
    document.getElementById('countdown').textContent = 'Автоматически восстановить соединение не получилось — нажмите кнопку или зайдите по этой же ссылке чуть позже. Ваши данные не потеряны.'
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
