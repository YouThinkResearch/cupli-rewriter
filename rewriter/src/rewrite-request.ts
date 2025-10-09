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

export type RewrittenHost = [host: string, alias?: string]

export type Configuration = {
  rewrittenHosts: RewrittenHost[]
  proxyHost: string
  relaySecretKey: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export const unserializeHost = (host: string, proxyHost: string, rewrittenHosts: RewrittenHost[]): string | null => {
  const suffix = `.${proxyHost}`
  if (!host.endsWith(suffix)) return null

  const serializedHost = host.slice(0, -suffix.length)

  // First check if it's an alias
  for (const [originalHost, alias] of rewrittenHosts) {
    if (alias && serializedHost === alias) {
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

export const serializeHost = (host: string, proxyHost: string, alias?: string) =>
  alias ? `${alias}.${proxyHost}` : `${host.replaceAll('.', '--')}.${proxyHost}`

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

  const targetHost = unserializeHost(fwdHost, config.proxyHost, config.rewrittenHosts)

  if (!targetHost) {
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

	upstreamHeaders.set('x-relay-ip-addr', fwdIP)

  const req = new Request(upstreamURL.toString(), {
    method: request.method,
    headers: upstreamHeaders,
    redirect: 'manual',
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
  })

  const upstreamResp = await fetch(req, {
    redirect: 'manual',
  })

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

    if (!value) continue
    // quick path – skip if none of our hosts appear at all (case‑sensitive for perf)
    if (!config.rewrittenHosts.some(([host]) => value.includes(host))) continue

    let rewritten = value
    for (const [host, alias] of config.rewrittenHosts) {
      rewritten = rewritten
        .replace(urlHostRegex(host), (match) => match.replace(host, serializeHost(host, config.proxyHost, alias)))
        .replace(quotedHostRegex(host), (match) => match.replace(host, serializeHost(host, config.proxyHost, alias)))
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
    for (const [host, alias] of config.rewrittenHosts) {
      text = text
        .replace(urlHostRegex(host), (match) => match.replace(host, serializeHost(host, config.proxyHost, alias)))
        .replace(quotedHostRegex(host), (match) => match.replace(host, serializeHost(host, config.proxyHost, alias)))
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
