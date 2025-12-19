import { CacheInterface } from './cache-interface'
import { lookupIPWithCache } from './ip-lookup'

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

const ENABLE_GEOIP_LOOKUP = false

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
  const fwdIP = request.headers.get('x-forwarded-for')?.split(',')[0] || ''

  if (!fwdHost || !fwdIP || !fwdHost.endsWith(config.proxyHost)) {
    return new Response('Not found', { status: 404 })
  }

  const targetHost = unserializeHost(fwdHost, config.proxyHost, config.rewrittenHosts)

  if (!targetHost) {
    return new Response('Not found', { status: 404 })
  }

  const upstreamURL = new URL(request.url)
  upstreamURL.hostname = targetHost // preserve original path & query
  upstreamURL.port = '443'
  upstreamURL.protocol = 'https:'

  // -----------------------------------------------------------------
  // Forward the request
  // -----------------------------------------------------------------
  const upstreamHeaders = new Headers()
  for (const [name, value] of request.headers) {
    if (!OMITTED_HEADERS.has(name.toLowerCase())) {
      upstreamHeaders.set(name, value)
    }
  }

  const shouldAppendIp = targetHost === 'survey.alchemer.com' && request.method === 'GET'

  if (shouldAppendIp) {
    if (ENABLE_GEOIP_LOOKUP) {
      const ipLookup = await lookupIPWithCache(fwdIP, cache)

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

  console.log('proxying to: ', upstreamURL.toString(), upstreamHeaders)
  const req = new Request(upstreamURL.toString(), {
    method: request.method,
    headers: upstreamHeaders,
    redirect: 'manual',
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
  })

  const upstreamResp = await fetch(req, {
    redirect: 'manual',
  })

  if (upstreamResp.status === 404) {
    return Response.redirect('https://cup.li', 302)
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
    responseBody = text
    bodyWasModified = true
  }

  // The body may have changed length – remove the original header
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

  return new Response(responseBody, {
    status: upstreamResp.status,
    statusText: upstreamResp.statusText,
    headers: newHeaders,
  })
}
