import type { TypeId } from 'typeid-js'
import { fromString, typeidUnboxed } from 'typeid-js'
import { CacheInterface } from './cache-interface'
import { fetchViaIP, resolveIPv4 } from './happy-fetch'
import { lookupIPWithCache } from './ip-lookup'
import { log } from './logger'
import { renderRetryPage } from './retry-page'
import { clearSubmission, isStorableSubmission, loadSubmission, storeSubmission, Submission, SURVEY_PATH_REGEX } from './survey-session'

const SESSION_COOKIE_NAME = '_rw_sid'
const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

const OMITTED_HEADERS = new Set([
  // connection details
  'x-cdn-node-addr',
  'x-cdn-requestor',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-proto',
  'x-tcpinfo-rtt',
  // request meta we intentionally re‑create/strip
  'host',
  'accept-encoding',
  'content-encoding',
  'content-length',
  'x-forwarded-for',
  'x-forwarded-request-id',
  'x-real-ip',
  'via',
  'alt-svc',
  'connection',
  'vary',
])

const ENABLE_GEOIP_LOOKUP = true

export type RewrittenHost = [host: string, alias?: string]

export interface Configuration {
  rewrittenHosts: RewrittenHost[]
  proxyHost: string
  relaySecretKey: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function unserializeHost(host: string, proxyHost: string, rewrittenHosts: RewrittenHost[]): string | null {
  // Check if this is the root proxy host (alias: "@")
  if (host === proxyHost) {
    for (const [originalHost, alias] of rewrittenHosts) {
      if (alias === '@') {
        return originalHost
      }
    }
    return null
  }

  const suffix = `.${proxyHost}`
  if (!host.endsWith(suffix))
    return null

  const serializedHost = host.slice(0, -suffix.length)

  // First check if it's an alias (excluding "@" which is handled above)
  for (const [originalHost, alias] of rewrittenHosts) {
    if (alias && alias !== '@' && serializedHost === alias) {
      return originalHost
    }
  }

  // If not an alias, deserialize the dashed format
  const deserializedHost = serializedHost.replaceAll('--', '.')

  // Check if this deserialized host exists in our configuration
  for (const [originalHost] of rewrittenHosts) {
    if (originalHost === deserializedHost) {
      return originalHost
    }
  }

  return null
}

export function serializeHost(host: string, proxyHost: string, alias?: string) {
  if (alias === '@')
    return proxyHost
  return alias ? `${alias}.${proxyHost}` : `${host.replaceAll('.', '--')}.${proxyHost}`
}

// Replace any Domain attribute (with or without leading dot)
function rewriteSetCookieHeader(cookie: string, newDomain: string) {
  return cookie.replace(/(^|;\s*)domain=[^;]+/i, `$1domain=${newDomain}`)
}

// real URLs: http://host … https://host … //host
export function urlHostRegex(host: string) {
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:https?:\\/\\/|\\/\\/)${escaped}`, 'gi')
}

// bare host wrapped in quotes: "host"  'host'  `host`
export function quotedHostRegex(host: string) {
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:\"|'|\\\`)${escaped}(?:\"|'|\\\`)`, 'gi')
}

function acceptsGzip(acceptEncoding: string | null): boolean {
  if (!acceptEncoding)
    return false

  // RFC 9110 style: gzip, br;q=0.8, *;q=0
  for (const rawToken of acceptEncoding.split(',')) {
    const token = rawToken.trim()
    if (!token)
      continue

    const [coding, ...params] = token.split(';').map(s => s.trim())
    if (coding.toLowerCase() !== 'gzip')
      continue

    const qParam = params.find(p => p.toLowerCase().startsWith('q='))
    if (!qParam)
      return true

    const qValue = Number.parseFloat(qParam.slice(2))
    if (!Number.isNaN(qValue) && qValue > 0)
      return true
  }

  return false
}

function addVary(headers: Headers, value: string) {
  const existing = headers.get('vary')
  if (!existing) {
    headers.set('vary', value)
    return
  }

  const parts = existing.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  if (!parts.includes(value.toLowerCase()))
    headers.set('vary', `${existing}, ${value}`)
}

function isBunRuntime(): boolean {
  // Avoid importing/typing Bun so this code stays valid in non-Bun runtimes (Workers).
  return typeof (globalThis as any).Bun !== 'undefined'
}

function parseSessionId(cookieHeader: string | null): TypeId<'session'> | null {
  try {
    if (!cookieHeader)
      return null
    for (const part of cookieHeader.split(';')) {
      const [name, ...rest] = part.split('=')
      if (name.trim() === SESSION_COOKIE_NAME)
        return fromString(rest.join('=').trim(), 'session') || null
    }
    return null
  }
  catch (error) {
    log.warn('error parsing session id', { error, cookie: cookieHeader })
    return null
  }
}

function stripSessionCookie(cookieHeader: string): string {
  return cookieHeader
    .split(';')
    .filter(part => part.split('=')[0].trim() !== SESSION_COOKIE_NAME)
    .join(';')
    .trim()
}

async function maybeGzipDownstreamBody(opts: {
  request: Request
  status: number
  headers: Headers
  body: BodyInit | null
}): Promise<{ body: BodyInit | null, modified: boolean }> {
  const { request, status, headers, body } = opts

  if (!isBunRuntime())
    return { body, modified: false }

  const shouldGzip
    = acceptsGzip(request.headers.get('accept-encoding'))
      && request.method !== 'HEAD'
      && status !== 204
      && status !== 304
      && status !== 206
      && !headers.has('content-range')
      && !headers.get('content-encoding')

  // Keep it simple: only gzip strings (the rewritten text case) to avoid buffering
  // arbitrary upstream streams/binaries into memory.
  if (!shouldGzip || typeof body !== 'string')
    return { body, modified: false }

  const bun = (globalThis as any).Bun
  const gzip = bun?.gzip ?? bun?.gzipSync
  if (!gzip)
    return { body, modified: false }

  const gzipped = await gzip(body)
  headers.set('content-encoding', 'gzip')
  addVary(headers, 'accept-encoding')
  headers.delete('content-length')

  return { body: gzipped, modified: true }
}

export default async function handleRequest(request: Request, config: Configuration, cache: CacheInterface): Promise<Response> {
  const fwdHost = request.headers.get('x-forwarded-host')?.toLowerCase() || ''
  const fwdIP = (request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]) || ''

  if (!fwdHost || !fwdIP || !fwdHost.endsWith(config.proxyHost)) {
    log.warn('request rejected: missing forwarded headers', { fwdHost, ip: fwdIP })
    return new Response('Not found', { status: 404 })
  }

  const targetHost = unserializeHost(fwdHost, config.proxyHost, config.rewrittenHosts)

  if (!targetHost) {
    log.warn('request rejected: unknown host', { fwdHost, ip: fwdIP })
    return new Response('Not found', { status: 404 })
  }

  // Short-circuit browser noise: upstream 404s these anyway, so answering
  // locally removes them from upstream traffic and from the error rate.
  const requestPath = new URL(request.url).pathname
  if (requestPath === '/favicon.ico' || requestPath === '/robots.txt')
    return new Response(null, { status: 404 })

  // -----------------------------------------------------------------
  // Session ID: read from cookie or generate a new one
  // -----------------------------------------------------------------
  const cookieHeader = request.headers.get('cookie')
  const existingSessionId = parseSessionId(cookieHeader)
  const sessionId = existingSessionId ?? typeidUnboxed('session')
  const isNewSession = !existingSessionId

  const reqLog = log.child({ sessionId, ip: fwdIP })

  const upstreamURL = new URL(request.url)
  upstreamURL.hostname = targetHost // preserve original path & query
  upstreamURL.port = '443'
  upstreamURL.protocol = 'https:'

  // sec-fetch-mode is 'navigate' for document navigations; sec-fetch-dest is
  // 'document'. Fall back to the accept header for clients without sec-fetch.
  const isNavigation = request.headers.get('sec-fetch-dest') === 'document'
    || request.headers.get('sec-fetch-mode') === 'navigate'
    || (request.headers.get('accept') ?? '').includes('text/html')

  const isSurveyPage = targetHost === 'survey.alchemer.com' && SURVEY_PATH_REGEX.test(upstreamURL.pathname)

  // -----------------------------------------------------------------
  // Survey session reinstatement (see survey-session.ts)
  // -----------------------------------------------------------------
  if (isSurveyPage && request.method === 'GET' && upstreamURL.searchParams.has('rewriter_reset')) {
    await clearSubmission(cache, sessionId, upstreamURL.pathname)
    const cleanURL = new URL(`https://${fwdHost}${upstreamURL.pathname}${upstreamURL.search}`)
    cleanURL.searchParams.delete('rewriter_reset')
    reqLog.info('survey session reset', { path: upstreamURL.pathname })
    return new Response(null, { status: 302, headers: { location: cleanURL.toString() } })
  }

  let replayedSubmission: Submission | null = null
  if (isSurveyPage && request.method === 'GET' && existingSessionId && isNavigation) {
    replayedSubmission = await loadSubmission(cache, sessionId, upstreamURL.pathname)
    if (replayedSubmission)
      reqLog.info('reinstating survey session by replaying stored submission', { path: upstreamURL.pathname })
  }

  const upstreamMethod = replayedSubmission ? 'POST' : request.method

  // -----------------------------------------------------------------
  // Forward the request
  // -----------------------------------------------------------------
  const upstreamHeaders = new Headers()
  for (const [name, value] of request.headers) {
    if (!OMITTED_HEADERS.has(name.toLowerCase())) {
      upstreamHeaders.set(name, value)
    }
  }

  // Strip our session cookie so it is never forwarded upstream
  const upstreamCookie = upstreamHeaders.get('cookie')
  if (upstreamCookie) {
    const cleaned = stripSessionCookie(upstreamCookie)
    if (cleaned)
      upstreamHeaders.set('cookie', cleaned)
    else
      upstreamHeaders.delete('cookie')
  }

  const shouldAppendIp = targetHost === 'survey.alchemer.com'

  if (shouldAppendIp) {
    // Always append the session id for Alchemer
    upstreamURL.searchParams.delete('rewriter_session')
    upstreamURL.searchParams.set('rewriter_session', sessionId)

    if (ENABLE_GEOIP_LOOKUP) {
      const ipLookup = await lookupIPWithCache(fwdIP, cache, reqLog)

      for (const [key, value] of Object.entries(ipLookup)) {
        const keyName = `rewriter_${key}`
        if (value) {
          upstreamURL.searchParams.delete(keyName)
          upstreamURL.searchParams.set(keyName, value)
        }
      }
    }
    else {
      upstreamURL.searchParams.delete('rewriter_ip')
      upstreamURL.searchParams.set('rewriter_ip', fwdIP)
    }
  }

  upstreamHeaders.set('x-relay-ip-addr', fwdIP)

  reqLog.info(`proxy request ${request.url} → ${upstreamURL.toString()}`, { method: request.method, targetHost, path: upstreamURL.pathname, headers: request.headers })

  // Buffer non-GET bodies so retries can resend them: a ReadableStream can only
  // be consumed once, so streaming `request.body` made every POST retry fail
  // with "body already used". Survey submissions are small; cap the buffer so a
  // pathological upload can't blow up memory (those fall back to streaming).
  const MAX_BUFFERED_BODY = 25 * 1024 * 1024
  const hasBody = !['GET', 'HEAD'].includes(upstreamMethod)
  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  let bufferedBody = hasBody && declaredLength <= MAX_BUFFERED_BODY && !replayedSubmission ? await request.arrayBuffer() : null

  if (replayedSubmission) {
    bufferedBody = replayedSubmission.body
    upstreamHeaders.set('content-type', replayedSubmission.contentType)
    upstreamHeaders.delete('content-length')
  }

  // Persist survey form submissions BEFORE forwarding so that a failed POST can
  // be recovered: the retry page navigates back via GET and the stored body is
  // replayed above.
  if (isSurveyPage && !replayedSubmission && bufferedBody && isStorableSubmission(request.method, request.headers.get('content-type')))
    await storeSubmission(cache, sessionId, upstreamURL.pathname, bufferedBody, request.headers.get('content-type')!)

  // EdgeCenter (in front of us) gives the origin ~10 s to start responding, so
  // OUR response headers must leave within ~8 s or the user gets EdgeCenter's
  // error page instead of ours. Hard deadline: stop retrying and answer (retry
  // page or 502) with sizable margin. The TTFB abort only guards time-to-headers;
  // once headers arrive it is cleared, so long body streams (video) still get
  // the full 30 s streaming budget.
  const REQUEST_DEADLINE_MS = 7_000
  const MAX_ATTEMPTS = 4
  const ATTEMPT_TTFB_MS = 3_000
  const requestStart = Date.now()

  let attempt = 0
  let upstreamResp: Response | null = null
  let lastError: unknown
  while (attempt < MAX_ATTEMPTS) {
    const remaining = REQUEST_DEADLINE_MS - (Date.now() - requestStart)
    // not enough budget left for a meaningful attempt — give up early so the
    // fallback response still beats the EdgeCenter timeout
    if (attempt > 0 && remaining < 700)
      break

    if (attempt > 0)
      await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 150))

    attempt++
    const startedAt = Date.now()

    const ttfbBudget = Math.min(ATTEMPT_TTFB_MS, Math.max(700, remaining - 300))
    const ttfbController = new AbortController()
    const ttfbTimer = setTimeout(() => ttfbController.abort(new Error('upstream TTFB timeout')), ttfbBudget)
    const signal = AbortSignal.any([AbortSignal.timeout(30_000), ttfbController.signal])

    try {
      // Happy-eyeballs across edge IPs: the first attempt uses the normal
      // (pooled) fetch; retries pin a different resolved IP each time so a
      // single unhealthy CloudFront edge can't eat the whole retry budget.
      // Only in Bun — Workers can't choose the destination address.
      let resp: Response
      const pinnedIPs = attempt > 1 && isBunRuntime() ? await resolveIPv4(targetHost) : []

      if (pinnedIPs.length > 0) {
        const ip = pinnedIPs[(attempt - 2) % pinnedIPs.length]
        reqLog.info('retrying via pinned ip', { targetHost, ip, attempt })
        resp = await fetchViaIP({
          url: upstreamURL,
          ip,
          method: upstreamMethod,
          headers: upstreamHeaders,
          body: hasBody ? bufferedBody : null,
          signal,
        })
      }
      else {
        const req = new Request(upstreamURL.toString(), {
          method: upstreamMethod,
          headers: upstreamHeaders,
          redirect: 'manual',
          signal,
          body: hasBody ? (bufferedBody ?? request.body) : undefined,
        })

        // it's okay to retry POST requests here, they are idempotent with alchemer
        resp = await fetch(req, {
          redirect: 'manual',
        })
      }

      if (resp.status === 502 || resp.status === 503 || resp.status === 504) {
        reqLog.warn('upstream error, retrying', { status: resp.status, targetHost, attempt, elapsedMs: Date.now() - startedAt })
        lastError = new Error(`upstream status ${resp.status}`)
        continue
      }

      upstreamResp = resp
      break
    }
    catch (error) {
      lastError = error
      reqLog.warn('upstream fetch failed, retrying', {
        targetHost,
        attempt,
        elapsedMs: Date.now() - startedAt,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      })
    }
    finally {
      clearTimeout(ttfbTimer)
    }
  }

  if (!upstreamResp) {
    reqLog.warn('all upstream attempts failed', {
      targetHost,
      path: upstreamURL.pathname,
      attempts: attempt,
      totalMs: Date.now() - requestStart,
      error: lastError instanceof Error ? `${lastError.name}: ${lastError.message}` : String(lastError),
    })

    // Page navigations get an auto-retrying interstitial instead of a raw 502.
    // A failed POST is recoverable: the body was stored above, and the page's
    // GET navigation replays it through the reinstatement path.
    if (isNavigation) {
      const headers = new Headers({
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-rewriter-error': 'upstream-unavailable',
      })
      if (isNewSession)
        headers.append('set-cookie', `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_COOKIE_MAX_AGE}`)
      return new Response(renderRetryPage(), { status: 200, headers })
    }

    return new Response('Bad gateway', { status: 502 })
  }

  if (upstreamResp.status === 404) {
    reqLog.info('upstream 404', { targetHost, path: upstreamURL.pathname })
    // sec-fetch-mode is never 'document' (that's a sec-fetch-dest value), so
    // this redirect previously never fired; isNavigation checks both headers.
    if (isNavigation)
      return Response.redirect('https://cup.li', 302)
    else
      return new Response(null, { status: 404 })
  }

  const newHeaders = new Headers(upstreamResp.headers)

  if (upstreamResp.headers.has('set-cookie')) {
    const cookies = upstreamResp.headers.getSetCookie()

    newHeaders.delete('set-cookie')
    for (const cookie of cookies) {
      newHeaders.append('set-cookie', rewriteSetCookieHeader(cookie, fwdHost))
    }
  }

  // 🔸 Rewrite any absolute URLs in headers (Location, Content‑Location,
  //     Link, etc.) so that the client stays on the proxy domain
  for (const [key, value] of [...newHeaders]) {
    if (OMITTED_HEADERS.has(key.toLowerCase())) {
      // content-length is handled below after we know whether the body changed.
      // Deleting it here would break binary (video/image) pass-through responses.
      if (key.toLowerCase() === 'content-length')
        continue

      newHeaders.delete(key)

      continue
    }

    if (!value)
      continue
    // quick path – skip if none of our hosts appear at all (case‑sensitive for perf)
    if (!config.rewrittenHosts.some(([host]) => value.includes(host)))
      continue

    let rewritten = value
    for (const [host, alias] of config.rewrittenHosts) {
      rewritten = rewritten
        .replace(urlHostRegex(host), (match) => match.replace(host, serializeHost(host, config.proxyHost, alias)))
        .replace(quotedHostRegex(host), (match) => match.replace(host, serializeHost(host, config.proxyHost, alias)))
        .replace('http://', 'https://')
    }
    newHeaders.set(key, rewritten)
  }

  // -----------------------------------------------------------------
  // Rewrite body when it is textual
  // -----------------------------------------------------------------
  const ctype = upstreamResp.headers.get('content-type') || ''
  const isText = /^(?:text\/|application\/(?:json|javascript|xml|html))/i.test(ctype)

  let responseBody: BodyInit | null = upstreamResp.body
  let bodyWasModified = false

  if (isText) {
    let text = await upstreamResp.text()
    // todo this might has performance issues, we might need to concat hosts into a single regex
    for (const [host, alias] of config.rewrittenHosts) {
      text = text
        .replace(urlHostRegex(host), (match) => match.replace(host, serializeHost(host, config.proxyHost, alias)))
        .replace(quotedHostRegex(host), (match) => match.replace(host, serializeHost(host, config.proxyHost, alias)))
    }
    // When we restored the session by replaying a stored submission, give the
    // user an escape hatch to start the survey from scratch.
    if (replayedSubmission && /text\/html/i.test(ctype)) {
      const linkParams = new URL(request.url).searchParams
      linkParams.set('rewriter_reset', '1')
      const resetLink = `<div style="text-align:center;padding:12px;font:13px/1.4 sans-serif"><a href="${upstreamURL.pathname}?${linkParams.toString()}">Начать опрос заново</a></div>`
      text = text.includes('</body>') ? text.replace('</body>', `${resetLink}</body>`) : text + resetLink
    }

    responseBody = text
    bodyWasModified = true
  }

  // Remove content-length only when the body was rewritten (text responses).
  // For binary content (video, images, etc.) the upstream value remains valid
  // and is required for range responses (206) and media streaming to work.
  if (isText)
    newHeaders.delete('content-length')

  const gzipResult = await maybeGzipDownstreamBody({
    request,
    status: upstreamResp.status,
    headers: newHeaders,
    body: responseBody,
  })
  responseBody = gzipResult.body
  bodyWasModified = bodyWasModified || gzipResult.modified

  // If we rewrote and/or gzipped, upstream validators are no longer valid
  if (bodyWasModified) {
    newHeaders.delete('etag')
    newHeaders.delete('content-md5')
  }

  // Only set the session cookie when it's a new session
  if (isNewSession) {
    newHeaders.append(
      'set-cookie',
      `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_COOKIE_MAX_AGE}`,
    )
  }

  reqLog.info('proxy response', { status: upstreamResp.status, targetHost, path: upstreamURL.pathname })

  return new Response(responseBody, {
    status: upstreamResp.status,
    statusText: upstreamResp.statusText,
    headers: newHeaders,
  })
}
