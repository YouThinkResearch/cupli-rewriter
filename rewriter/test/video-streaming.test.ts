import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handleRequest, { type Configuration } from '../src/rewrite-request'
import type { CacheInterface } from '../src/cache-interface'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const mockCache: CacheInterface = {
  get: async () => null,
  put: async () => {},
}

// Hosts that are configured as rewritten in this test suite.
// surveygizmolibrary.s3.amazonaws.com serialises to
// "surveygizmolibrary--s3--amazonaws--com.proxy.test"
const UPSTREAM_HOST = 'surveygizmolibrary.s3.amazonaws.com'
const PROXY_HOST = 'proxy.test'
const SERIALISED_HOST = `surveygizmolibrary--s3--amazonaws--com.${PROXY_HOST}`

const config: Configuration = {
  rewrittenHosts: [[UPSTREAM_HOST, undefined]],
  proxyHost: PROXY_HOST,
  relaySecretKey: 'test-secret',
}

function makeRequest(path: string, extraHeaders: Record<string, string> = {}): Request {
  return new Request(`https://${SERIALISED_HOST}${path}`, {
    headers: {
      'x-forwarded-host': SERIALISED_HOST,
      'x-real-ip': '1.2.3.4',
      ...extraHeaders,
    },
  })
}

// ---------------------------------------------------------------------------
// Video streaming acceptance tests
// ---------------------------------------------------------------------------

describe('video streaming', () => {
  beforeEach(() => {
    // Silence logger output during tests
    vi.spyOn(console, 'log').mockReturnValue(undefined)
    vi.spyOn(console, 'warn').mockReturnValue(undefined)
    vi.spyOn(console, 'info').mockReturnValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('proxies a 206 Partial Content range response and preserves content-length', async () => {
    const chunkSize = 1024 * 256 // 256 KB
    const totalSize = 50_000_000

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(new Uint8Array(chunkSize), {
        status: 206,
        statusText: 'Partial Content',
        headers: {
          'content-type': 'video/mp4',
          'content-length': String(chunkSize),
          'content-range': `bytes 0-${chunkSize - 1}/${totalSize}`,
          'accept-ranges': 'bytes',
        },
      }),
    ))

    const req = makeRequest('/library/343438/1213.mp4', {
      range: `bytes=0-${chunkSize - 1}`,
    })

    const resp = await handleRequest(req, config, mockCache)

    expect(resp.status).toBe(206)
    expect(resp.headers.get('content-length')).toBe(String(chunkSize))
    expect(resp.headers.get('content-range')).toBe(`bytes 0-${chunkSize - 1}/${totalSize}`)
    expect(resp.headers.get('accept-ranges')).toBe('bytes')
    expect(resp.headers.get('content-type')).toBe('video/mp4')
  })

  it('proxies a full 200 video response and preserves content-length', async () => {
    const fileSize = 5_000_000

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(new Uint8Array(fileSize), {
        status: 200,
        headers: {
          'content-type': 'video/mp4',
          'content-length': String(fileSize),
          'accept-ranges': 'bytes',
        },
      }),
    ))

    const req = makeRequest('/library/343438/1213.mp4')
    const resp = await handleRequest(req, config, mockCache)

    expect(resp.status).toBe(200)
    expect(resp.headers.get('content-length')).toBe(String(fileSize))
    expect(resp.headers.get('accept-ranges')).toBe('bytes')
    expect(resp.headers.get('content-type')).toBe('video/mp4')
  })

  it('passes the video body through without modification', async () => {
    // First 8 bytes of a typical ftyp box in an MP4 container
    const mp4Header = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70])

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(mp4Header, {
        status: 200,
        headers: {
          'content-type': 'video/mp4',
          'content-length': String(mp4Header.length),
        },
      }),
    ))

    const req = makeRequest('/library/343438/1213.mp4')
    const resp = await handleRequest(req, config, mockCache)

    const body = new Uint8Array(await resp.arrayBuffer())
    expect(body).toEqual(mp4Header)
  })

  it('proxies a HEAD request for a video and preserves content-length', async () => {
    const fileSize = 5_000_000

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: {
          'content-type': 'video/mp4',
          'content-length': String(fileSize),
          'accept-ranges': 'bytes',
        },
      }),
    ))

    const req = new Request(`https://${SERIALISED_HOST}/library/343438/1213.mp4`, {
      method: 'HEAD',
      headers: {
        'x-forwarded-host': SERIALISED_HOST,
        'x-real-ip': '1.2.3.4',
      },
    })

    const resp = await handleRequest(req, config, mockCache)

    expect(resp.status).toBe(200)
    expect(resp.headers.get('content-length')).toBe(String(fileSize))
    expect(resp.headers.get('accept-ranges')).toBe('bytes')
  })

  // Sanity-check: text responses must still drop content-length because
  // the body is rewritten and the length changes.
  it('removes content-length for text/html responses (body is rewritten)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('<html><body>hello</body></html>', {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-length': '31',
        },
      }),
    ))

    const req = makeRequest('/')
    const resp = await handleRequest(req, config, mockCache)

    expect(resp.status).toBe(200)
    // content-length must not be present: the rewritten body has unknown length
    expect(resp.headers.get('content-length')).toBeNull()
  })
})
