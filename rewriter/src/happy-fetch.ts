import { log } from './logger'

// Upstream hosts sit behind CloudFront, which announces several edge IPs per
// resolution. Bun's fetch cannot pin a destination address, so retries could
// keep landing on the same unhealthy edge. This module resolves the A records
// ourselves and performs requests to a chosen IP via node:https while keeping
// SNI + Host correct — a happy-eyeballs-style rotation across edge IPs.
//
// node:* modules are imported lazily so this file stays loadable in the
// Cloudflare Workers build, where the pinned path is never taken.

const DNS_TTL_MS = 30_000
const dnsCache = new Map<string, { ips: string[], at: number }>()

export async function resolveIPv4(host: string): Promise<string[]> {
  const hit = dnsCache.get(host)
  if (hit && Date.now() - hit.at < DNS_TTL_MS)
    return hit.ips

  try {
    const { resolve4 } = await import('node:dns/promises')
    const ips = await resolve4(host)
    if (ips.length)
      dnsCache.set(host, { ips, at: Date.now() })
    return ips
  }
  catch (error) {
    log.warn('dns resolve failed', { host, error: String(error) })
    return hit?.ips ?? []
  }
}

export interface PinnedRequestInit {
  url: URL
  ip: string
  method: string
  headers: Headers
  body: ArrayBuffer | null
  signal: AbortSignal
}

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])

// HTTPS request to a specific IP with SNI/Host kept on the real hostname.
// Does not follow redirects (matches fetch's redirect: 'manual').
export async function fetchViaIP({ url, ip, method, headers, body, signal }: PinnedRequestInit): Promise<Response> {
  const { default: https } = await import('node:https')
  const { Readable } = await import('node:stream')

  return new Promise((resolve, reject) => {
    const headerObj: Record<string, string> = {}
    for (const [name, value] of headers)
      headerObj[name] = value
    headerObj.host = url.hostname
    // node:https will not auto-decompress, so ask for identity encoding
    headerObj['accept-encoding'] = 'identity'

    const req = https.request({
      host: ip,
      servername: url.hostname,
      port: url.port ? Number(url.port) : 443,
      path: url.pathname + url.search,
      method,
      headers: headerObj,
    }, (res) => {
      const respHeaders = new Headers()
      for (let i = 0; i < res.rawHeaders.length; i += 2)
        respHeaders.append(res.rawHeaders[i], res.rawHeaders[i + 1])

      const status = res.statusCode ?? 502
      const respBody = NULL_BODY_STATUSES.has(status) || method === 'HEAD'
        ? null
        : Readable.toWeb(res) as unknown as ReadableStream

      resolve(new Response(respBody, { status, statusText: res.statusMessage ?? '', headers: respHeaders }))
    })

    const onAbort = () => req.destroy(new Error('request aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
    req.on('error', (error) => {
      signal.removeEventListener('abort', onAbort)
      reject(error)
    })
    req.on('close', () => signal.removeEventListener('abort', onAbort))

    if (body && body.byteLength > 0)
      req.write(new Uint8Array(body))
    req.end()
  })
}
