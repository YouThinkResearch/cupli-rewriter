import { beforeEach, describe, expect, it } from 'vitest'
import type { StatsStore } from '../src/stats'
import { flushStats, loadStats, recordRequest, resetStats, snapshot, statusOutcome } from '../src/stats'
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
    expect(s.latency.total.p50).toBeCloseTo(400, -1)
    expect(Math.abs(s.latency.upstream.p50! - 380) / 380).toBeLessThanOrEqual(0.011)
    expect(s.series).toHaveLength(60)
  })

  // Regression: coarse 100ms bins reported every value as its bin edge (450 -> "500 ms").
  // The log histogram must stay within ~1% across the whole range.
  it('percentiles stay within 1% of the true value', () => {
    for (const ms of [3, 47, 450, 1180, 9800, 61000]) {
      resetStats()
      recordRequest({ outcome: 'ok', host: 'h', totalMs: ms })
      const p = snapshot(60).latency.total.p50!
      expect(Math.abs(p - ms) / ms).toBeLessThanOrEqual(0.011)
    }
  })

  // ~16k req/min is a real peak: recording and a 24h snapshot must stay cheap.
  it('handles peak volume cheaply', () => {
    const t0 = performance.now()
    for (let i = 0; i < 200_000; i++) recordRequest({ outcome: 'ok', host: 'survey.alchemer.com', totalMs: 300 + (i % 900), upstreamMs: 290 + (i % 900) })
    const t1 = performance.now()
    const s = snapshot(1440)
    const t2 = performance.now()
    expect(s.requests).toBe(200_000)
    expect(s.latency.total.p50!).toBeGreaterThan(700)
    expect(s.latency.total.p50!).toBeLessThan(770)
    expect(t1 - t0).toBeLessThan(1000)
    expect(t2 - t1).toBeLessThan(500)
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

  // The user requirement: history must survive restarts and deploys.
  it('survives a restart through the store', async () => {
    const kv = new Map<string, string>()
    const store: StatsStore = {
      mget: async keys => keys.map(k => kv.get(k) ?? null),
      set: async (k, v) => { kv.set(k, v) },
      setnx: async (k, v) => { if (!kv.has(k)) kv.set(k, v); return kv.get(k)! },
    }
    for (let i = 0; i < 50; i++) recordRequest({ outcome: 'ok', host: 'survey.alchemer.com', totalMs: 500 + i, upstreamMs: 480 + i })
    recordRequest({ outcome: 'failed', host: 'survey.alchemer.com', totalMs: 7000, attempts: 4 })
    const before = snapshot(60)
    await flushStats(store)

    resetStats() // the "restart"
    expect(snapshot(60).requests).toBe(0)

    await loadStats(store)
    const after = snapshot(60)
    expect(after.requests).toBe(before.requests)
    expect(after.outcomes).toEqual(before.outcomes)
    expect(after.latency).toEqual(before.latency)
    expect(after.hosts).toEqual(before.hosts)
  })
})
