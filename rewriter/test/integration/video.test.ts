/**
 * Integration tests — real network, no mocks.
 *
 * These tests call handleRequest() with a real upstream fetch to
 * surveygizmolibrary.s3.amazonaws.com so the full proxy round-trip is
 * exercised, including Range/206 video streaming.
 *
 * Run with:  bun test test/integration/
 */
import { describe, expect, test } from 'bun:test'
import type { CacheInterface } from '../../src/cache-interface'
import handleRequest, { type Configuration } from '../../src/rewrite-request'

// ---------------------------------------------------------------------------
// Config that mirrors production for the S3 library host
// ---------------------------------------------------------------------------
const UPSTREAM_HOST = 'surveygizmolibrary.s3.amazonaws.com'
const PROXY_HOST = 'freesurveycupli.com'
const SERIALISED_HOST = `surveygizmolibrary--s3--amazonaws--com.${PROXY_HOST}`
const VIDEO_PATH = '/library/343438/1213.mp4'

const config: Configuration = {
  rewrittenHosts: [[UPSTREAM_HOST, undefined]],
  proxyHost: PROXY_HOST,
  relaySecretKey: 'test-secret',
}

const noopCache: CacheInterface = {
  get: async () => null,
  put: async () => {},
}

function videoRequest(extraHeaders: Record<string, string> = {}, method = 'GET'): Request {
  return new Request(`https://${SERIALISED_HOST}${VIDEO_PATH}`, {
    method,
    headers: {
      'x-forwarded-host': SERIALISED_HOST,
      'x-real-ip': '1.2.3.4',
      ...extraHeaders,
    },
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('video streaming – real network (surveygizmolibrary.s3.amazonaws.com)', () => {
  test('HEAD: returns 200 with content-length and accept-ranges', async () => {
    const resp = await handleRequest(videoRequest({}, 'HEAD'), config, noopCache)

    expect(resp.status).toBe(200)
    // content-length must be present so the player knows the file size
    const contentLength = resp.headers.get('content-length')
    expect(contentLength).not.toBeNull()
    expect(Number(contentLength)).toBeGreaterThan(0)
    expect(resp.headers.get('accept-ranges')).toBe('bytes')
  }, 20_000)

  test('Range request: returns 206 with correct content-range and content-length', async () => {
    const chunkSize = 256 * 1024 // 256 KB – typical first chunk a browser requests
    const rangeHeader = `bytes=0-${chunkSize - 1}`

    const resp = await handleRequest(
      videoRequest({ range: rangeHeader }),
      config,
      noopCache,
    )

    expect(resp.status).toBe(206)

    const contentLength = resp.headers.get('content-length')
    expect(contentLength).not.toBeNull()
    expect(Number(contentLength)).toBe(chunkSize)

    const contentRange = resp.headers.get('content-range')
    expect(contentRange).toMatch(/^bytes 0-\d+\/\d+$/)

    expect(resp.headers.get('content-type')).toMatch(/video\//i)
  }, 30_000)

  test('Range response body contains the exact number of requested bytes', async () => {
    const chunkSize = 32 * 1024 // 32 KB – small enough to read quickly

    const resp = await handleRequest(
      videoRequest({ range: `bytes=0-${chunkSize - 1}` }),
      config,
      noopCache,
    )

    expect(resp.status).toBe(206)
    const body = await resp.arrayBuffer()
    expect(body.byteLength).toBe(chunkSize)
  }, 30_000)

  test('Range response body starts with MP4 ftyp box magic bytes', async () => {
    const resp = await handleRequest(
      videoRequest({ range: 'bytes=0-7' }),
      config,
      noopCache,
    )

    expect(resp.status).toBe(206)
    const bytes = new Uint8Array(await resp.arrayBuffer())

    // An MP4 file starts with a 4-byte box size then the ASCII string "ftyp"
    // bytes[4..7] === 0x66 0x74 0x79 0x70
    expect(bytes[4]).toBe(0x66) // 'f'
    expect(bytes[5]).toBe(0x74) // 't'
    expect(bytes[6]).toBe(0x79) // 'y'
    expect(bytes[7]).toBe(0x70) // 'p'
  }, 30_000)
})
