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
<meta name="description" content="Временный сбой соединения с сервисом опросов. Страница восстановит соединение автоматически, данные не потеряны.">
<meta name="theme-color" content="#f5f6f8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#17181c" media="(prefers-color-scheme: dark)">
<title>Восстанавливаем соединение…</title>
<noscript><meta http-equiv="refresh" content="5"></noscript>
<style>
  :root {
    color-scheme: light dark;
    --bg: #ffffff;
    --text: #171717;
    --text-secondary: #6e6e73;
    --accent: #0071e3;
    --accent-strong: #0077ed;
    --ring: #d2d2d7;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #000000;
      --text: #f5f5f7;
      --text-secondary: #a1a1a6;
      --accent: #2997ff;
      --accent-strong: #55aaff;
      --ring: #3a3a3c;
    }
  }
  * { box-sizing: border-box; }
  body {
    font: 17px/1.55 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; margin: 0; padding: 24px;
    background: var(--bg); color: var(--text);
  }
  main { max-width: 34em; width: 100%; text-align: center; }
  @media (prefers-reduced-motion: no-preference) {
    main { animation: enter .6s cubic-bezier(.16, 1, .3, 1) both; }
    @keyframes enter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  }
  .indicator { position: relative; width: 52px; height: 52px; margin: 0 auto 28px; }
  .indicator svg.icon { position: absolute; inset: 0; margin: auto; color: var(--text-secondary); }
  .ring {
    position: absolute; inset: 0; border-radius: 50%;
    border: 2px solid var(--ring); border-top-color: var(--text-secondary);
  }
  @media (prefers-reduced-motion: no-preference) {
    .ring { animation: spin 1.1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  }
  @media (prefers-reduced-motion: reduce) {
    .ring { border-top-color: var(--ring); border-bottom-color: var(--text-secondary); }
  }
  h1 {
    font-size: 28px; line-height: 1.2; letter-spacing: -0.015em;
    font-weight: 600; margin: 0 0 20px; text-wrap: balance;
  }
  p { margin: 0 0 14px; color: var(--text-secondary); font-size: 17px; text-wrap: pretty; }
  p strong { color: var(--text); font-weight: 500; }
  #countdown { margin: 24px 0 0; font-variant-numeric: tabular-nums; }
  button {
    display: none; margin: 24px auto 0; padding: 11px 26px;
    font: inherit; font-size: 17px; border: 0; border-radius: 980px;
    background: var(--accent); color: #fff; cursor: pointer;
    transition: background-color .15s ease-out;
  }
  button:hover { background: var(--accent-strong); }
  button:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 980px; }
  summary:focus-visible { border-radius: 4px; }
  details { margin-top: 40px; font-size: 13px; color: var(--text-secondary); }
  details summary { cursor: pointer; padding: 2px 0; }
  details code {
    display: block; white-space: pre-wrap; word-break: break-all; text-align: left;
    padding: 10px 0 0; margin: 0 auto; max-width: 30em;
    font-size: 12px; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  }
</style>
</head>
<body>
<main>
  <div class="indicator" role="img" aria-label="Идёт восстановление соединения">
    <div class="ring"></div>
    <svg class="icon" aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 12.55a11 11 0 0 1 14.08 0"/>
      <path d="M8.53 15.9a6 6 0 0 1 6.95 0"/>
      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/>
    </svg>
  </div>
  <h1>Восстанавливаем соединение с&nbsp;опросом</h1>
  <p>Сервис опросов сейчас не отвечает — обычно это длится несколько секунд. Мы сделали ${details.attempts === 0 ? 'попытку' : `${details.attempts} попыт${details.attempts === 1 ? 'ку' : details.attempts < 5 ? 'ки' : 'ок'}`} соединиться и продолжаем автоматически.</p>
  <p><strong>${dataSafety}</strong></p>
  <p>Можно ничего не делать — страница обновится сама. Также можно обновить её вручную или открыть эту же ссылку позже: вы вернётесь к своему месту в опросе.</p>
  <p id="countdown" aria-live="polite"></p>
  <button id="retryBtn" onclick="doRetry()">Повторить подключение</button>
  <details>
    <summary>Технические детали</summary>
    <code translate="no">time: ${now}
reason: ${details.reason}
attempts: ${details.attempts} (${details.totalMs} ms)
path: ${details.path}
session: ${details.sessionId}
saved-form: ${details.hasStoredSubmission ? 'yes' : 'no (progress on survey server)'}</code>
  </details>
</main>
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
    // always navigate as GET: a stored submission is resent server-side.
    // strip the manual error trigger so a forced test error recovers on retry
    var params = new URLSearchParams(location.search)
    params.delete('rewriter_force_error')
    var query = params.toString()
    location.replace(location.pathname + (query ? '?' + query : ''))
  }

  if (attempt >= MAX_AUTO) {
    sessionStorage.removeItem(key)
    document.querySelector('.indicator').style.display = 'none'
    document.getElementById('retryBtn').style.display = 'block'
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
