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
  'connection',
  'content-length',
  'x-forwarded-for',
  'x-forwarded-request-id',
  'x-real-ip',
])

export type Configuration = {
  rewrittenHosts: string[]
  proxyHost: string
  relaySecretKey: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const unserializeHost = (host: string, proxyHost: string) =>
  host.replaceAll('--', '.').replace(new RegExp(`\\.${proxyHost}$`, 'i'), '')

const serializeHost = (host: string, proxyHost: string) => `${host.replaceAll('.', '--')}.${proxyHost}`

// Replace any Domain attribute (with or without leading dot)
const rewriteSetCookieHeader = (cookie: string, newDomain: string) =>
  cookie.replace(/(^|;\s*)domain=\.?[^;]+/i, `$1domain=${newDomain}`)

// real URLs: http://host … https://host … //host
export const urlHostRegex = (host: string) => {
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:https?:\\/\\/|\\/\\/)${escaped}`, 'gi')
}

// bare host wrapped in quotes: "host"  'host'  `host`
export const quotedHostRegex = (host: string) => {
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:\"|'|\\\`)${escaped}(?:\"|'|\\\`)`, 'gi')
}

export default async function handleRequest(request: Request, config: Configuration): Promise<Response> {
  const fwdHost = request.headers.get('x-forwarded-host')?.toLowerCase() || ''
  const fwdIP = request.headers.get('x-cdn-node-addr') || ''

  if (!fwdHost || !fwdIP || !fwdHost.endsWith(config.proxyHost)) {
    return new Response('Not found', { status: 404 })
  }

  const targetHost = unserializeHost(fwdHost, config.proxyHost)

  if (!config.rewrittenHosts.includes(targetHost)) {
    return new Response('Not found', { status: 404 })
  }

  const upstreamURL = new URL(request.url)
  upstreamURL.hostname = targetHost // preserve original path & query

  //-----------------------------------------------------------------
  // Forward the request
  //-----------------------------------------------------------------
  const upstreamHeaders = new Headers()
  for (const [name, value] of request.headers) {
    if (!OMITTED_HEADERS.has(name.toLowerCase())) {
      upstreamHeaders.set(name, value)
    }
  }

  const req = new Request(upstreamURL.toString(), {
    method: request.method,
    headers: upstreamHeaders,
    redirect: 'manual',
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
  })

  console.log('upstreamURL', upstreamURL.toString(), request.method, JSON.stringify(Object.fromEntries(upstreamHeaders.entries())), request.body)
  const upstreamResp = await fetch(req)

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
    if (!value) continue
    // quick path – skip if none of our hosts appear at all (case‑sensitive for perf)
    if (!config.rewrittenHosts.some((h) => value.includes(h))) continue

    let rewritten = value
    for (const host of config.rewrittenHosts) {
      rewritten = rewritten
        .replace(urlHostRegex(host), (match) => match.replace(host, serializeHost(host, config.proxyHost)))
        .replace(quotedHostRegex(host), (match) => match.replace(host, serializeHost(host, config.proxyHost)))
        .replace('http://', 'https://')
        .replace('https://hub.youthink.io/', 'https://hub.ru.youthink.io/')
    }
    newHeaders.set(key, rewritten)
  }

  //-----------------------------------------------------------------
  // Rewrite body when it is textual
  //-----------------------------------------------------------------
  const ctype = upstreamResp.headers.get('content-type') || ''
  const isText = /^(text\/|application\/(json|javascript|xml|html))/i.test(ctype)

  let responseBody: BodyInit | null = upstreamResp.body

  if (isText) {
    let text = await upstreamResp.text()
    // todo this might has performance issues, we might need to concat hosts into a single regex
    for (const host of config.rewrittenHosts) {
      text = text
        .replace(urlHostRegex(host), (match) => match.replace(host, serializeHost(host, config.proxyHost)))
        .replace(quotedHostRegex(host), (match) => match.replace(host, serializeHost(host, config.proxyHost)))
    }
    responseBody = text
  }

  // The body may have changed length – remove the original header
  newHeaders.delete('content-length')

  return new Response(responseBody, {
    status: upstreamResp.status,
    statusText: upstreamResp.statusText,
    headers: newHeaders,
  })
}
