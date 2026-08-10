import type { CacheInterface } from '../src/cache-interface'
import type { Configuration } from '../src/rewrite-request'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handleRequest from '../src/rewrite-request'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

class MemoryCache implements CacheInterface {
  store = new Map<string, any>()
  async get<T>(key: string): Promise<T | null> {
    return this.store.get(key) ?? null
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value)
  }
}

const UPSTREAM_HOST = 'survey.alchemer.com'
const PROXY_HOST = 'proxy.test'
const SERIALISED_HOST = `survey.${PROXY_HOST}`
const SESSION_ID = 'session_01krxtdb44e0085gegtxedb6kz'
const SURVEY_PATH = '/s3/8846329/'

const config: Configuration = {
  rewrittenHosts: [[UPSTREAM_HOST, 'survey']],
  proxyHost: PROXY_HOST,
  relaySecretKey: 'test-secret',
}

function makeRequest(path: string, init: RequestInit & { extraHeaders?: Record<string, string> } = {}): Request {
  const { extraHeaders, ...requestInit } = init
  return new Request(`https://${SERIALISED_HOST}${path}`, {
    ...requestInit,
    headers: {
      'x-forwarded-host': SERIALISED_HOST,
      'x-real-ip': '1.2.3.4',
      'cookie': `_rw_sid=${SESSION_ID}`,
      ...extraHeaders,
    },
  })
}

const FORM_BODY = 'sg_currentpageid=48&sg_surveyident=8846329&sg_sessionid=1786367757_abc&sgE-8846329-48-94=10433'

function htmlResponse(body = '<html><body>survey page</body></html>') {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html;charset=utf-8' } })
}

// the geoip lookup also goes through the stubbed fetch, so pick out the
// request that actually targets the upstream survey host
function upstreamCall(fetchMock: ReturnType<typeof vi.fn>): Request {
  const call = fetchMock.mock.calls.find(([req]) => (req as Request).url?.includes?.(UPSTREAM_HOST))
  if (!call)
    throw new Error('no upstream request was made')
  return call[0] as Request
}

describe('survey session reinstatement', () => {
  let cache: MemoryCache

  beforeEach(() => {
    cache = new MemoryCache()
    vi.spyOn(console, 'log').mockReturnValue(undefined)
    vi.spyOn(console, 'warn').mockReturnValue(undefined)
    vi.spyOn(console, 'info').mockReturnValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('stores a survey form POST and replays it on a later GET navigation', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(htmlResponse()))
    vi.stubGlobal('fetch', fetchMock)

    // 1. user submits a survey page
    const post = makeRequest(SURVEY_PATH, {
      method: 'POST',
      body: FORM_BODY,
      extraHeaders: { 'content-type': 'application/x-www-form-urlencoded' },
    })
    const postResp = await handleRequest(post, config, cache)
    expect(postResp.status).toBe(200)
    expect([...cache.store.keys()].some(k => k.startsWith('survey-form:'))).toBe(true)

    // 2. user comes back later via plain GET navigation → stored POST replayed
    fetchMock.mockClear()
    const get = makeRequest(SURVEY_PATH, {
      extraHeaders: { 'sec-fetch-mode': 'navigate', 'accept': 'text/html' },
    })
    const getResp = await handleRequest(get, config, cache)

    const forwarded = upstreamCall(fetchMock)
    expect(forwarded.method).toBe('POST')
    expect(await forwarded.text()).toBe(FORM_BODY)

    // 3. reinstated page carries the reset link
    const html = await getResp.text()
    expect(html).toContain('rewriter_reset=1')
    expect(html).toContain('Начать опрос заново')
  })

  it('does not replay for non-navigation GETs', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(htmlResponse()))
    vi.stubGlobal('fetch', fetchMock)

    await handleRequest(makeRequest(SURVEY_PATH, {
      method: 'POST',
      body: FORM_BODY,
      extraHeaders: { 'content-type': 'application/x-www-form-urlencoded' },
    }), config, cache)

    fetchMock.mockClear()
    await handleRequest(makeRequest(SURVEY_PATH, {
      extraHeaders: { 'sec-fetch-mode': 'cors', 'accept': 'application/json' },
    }), config, cache)

    expect(upstreamCall(fetchMock).method).toBe('GET')
  })

  it('rewriter_reset clears the stored submission and redirects clean', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(htmlResponse()))
    vi.stubGlobal('fetch', fetchMock)

    await handleRequest(makeRequest(SURVEY_PATH, {
      method: 'POST',
      body: FORM_BODY,
      extraHeaders: { 'content-type': 'application/x-www-form-urlencoded' },
    }), config, cache)

    fetchMock.mockClear()
    const resp = await handleRequest(makeRequest(`${SURVEY_PATH}?rewriter_reset=1`, {
      extraHeaders: { 'sec-fetch-mode': 'navigate', 'accept': 'text/html' },
    }), config, cache)

    expect(resp.status).toBe(302)
    expect(resp.headers.get('location')).toBe(`https://${SERIALISED_HOST}${SURVEY_PATH}`)
    expect(fetchMock).not.toHaveBeenCalled()

    // next GET must NOT replay (tombstoned)
    const follow = await handleRequest(makeRequest(SURVEY_PATH, {
      extraHeaders: { 'sec-fetch-mode': 'navigate', 'accept': 'text/html' },
    }), config, cache)
    expect(upstreamCall(fetchMock).method).toBe('GET')
    expect(await follow.text()).not.toContain('rewriter_reset')
  })

  it('serves the auto-retry page when all upstream attempts fail on a navigation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('bad', { status: 502 }))))

    const resp = await handleRequest(makeRequest(SURVEY_PATH, {
      method: 'POST',
      body: FORM_BODY,
      extraHeaders: {
        'content-type': 'application/x-www-form-urlencoded',
        'sec-fetch-mode': 'navigate',
        'accept': 'text/html',
      },
    }), config, cache)

    expect(resp.status).toBe(200)
    expect(resp.headers.get('x-rewriter-error')).toBe('upstream-unavailable')
    const html = await resp.text()
    expect(html).toContain('Восстанавливаем соединение')

    // the failed submission is stored for recovery via GET replay
    expect([...cache.store.keys()].some(k => k.startsWith('survey-form:'))).toBe(true)
  })

  it('returns 502 for failed non-navigation requests', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('bad', { status: 503 }))))

    const resp = await handleRequest(makeRequest('/api/data', {
      extraHeaders: { 'sec-fetch-mode': 'cors', 'accept': 'application/json' },
    }), config, cache)

    expect(resp.status).toBe(502)
  })

  it('answers favicon.ico and robots.txt locally without contacting upstream', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    for (const path of ['/favicon.ico', '/robots.txt']) {
      const resp = await handleRequest(makeRequest(path), config, cache)
      expect(resp.status).toBe(404)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
