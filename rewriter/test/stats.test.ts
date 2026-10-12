import { beforeEach, describe, expect, it } from 'vitest'
import { recordRequest, resetStats, snapshot, statusOutcome } from '../src/stats'
import { serveStats } from '../src/stats-page'

describe('stats', () => {
  beforeEach(() => resetStats())

  it('classifies statuses', () => {
    expect(statusOutcome(200)).toBe('ok')
    expect(statusOutcome(304)).toBe('redirect')
    expect(statusOutcome(403)).toBe('clientError')
    expect(statusOutcome(404)).toBe('notFound')
    expect(statusOutcome(502)).toBe('serverError')
  })

  it('counts outcomes, failure rate and per-host totals', () => {
    for (let i = 0; i < 8; i++) recordRequest({ outcome: 'ok', host: 'survey.alchemer.com', totalMs: 400, upstreamMs: 380 })
    recordRequest({ outcome: 'failed', host: 'survey.alchemer.com', totalMs: 7000, attempts: 4 })
    recordRequest({ outcome: 'rejected' })
    const s = snapshot(60)
    expect(s.requests).toBe(10)
    expect(s.failureRate).toBeCloseTo(0.1)
    expect(s.retried).toBe(1)
    expect(s.hosts[0]).toMatchObject({ host: 'survey.alchemer.com', count: 9, failed: 1 })
    expect(s.latency.total.p50).toBe(400)
    expect(s.latency.upstream.p50).toBe(400)
    expect(s.series).toHaveLength(60)
  })

  it('keeps ~60-96 points per range', () => {
    expect(snapshot(360).series).toHaveLength(72)
    expect(snapshot(1440).series).toHaveLength(96)
    expect(snapshot(999).rangeMinutes).toBe(60)
  })

  // The page must never be indexed or cached by the edge.
  it('serves noindex, no-store responses', async () => {
    const shell = serveStats('/.well-known/ip-stats', new URL('https://x/.well-known/ip-stats'))
    expect(shell.headers.get('x-robots-tag')).toContain('noindex')
    expect(shell.headers.get('cache-control')).toBe('no-store')
    expect(await shell.text()).toContain('name="robots" content="noindex')
    const js = serveStats('/.well-known/ip-stats/app.js', new URL('https://x'))
    expect(js.headers.get('content-type')).toContain('javascript')
    expect(serveStats('/.well-known/ip-stats/nope', new URL('https://x')).status).toBe(404)
  })
})
