// In-memory request metrics behind /.well-known/ip-stats.
//
// Per-minute buckets for the last 24h in a ring, each holding outcome counters, a
// latency histogram and per-host counts. Aggregates only - no client IPs, no paths.
// Lives in process memory, so it resets on restart; `startedAt` tells the page so.

export type Outcome =
  | 'ok' // 2xx from upstream
  | 'redirect' // 3xx from upstream
  | 'clientError' // 4xx other than 404 (e.g. Alchemer's 403s)
  | 'notFound' // upstream 404
  | 'serverError' // 5xx from upstream after retries
  | 'failed' // every attempt failed: retry page or our own 502
  | 'rejected' // no/invalid forwarded headers, unknown host

const OUTCOMES: Outcome[] = ['ok', 'redirect', 'clientError', 'notFound', 'serverError', 'failed', 'rejected']

// Upper bounds in ms. Percentiles are read back as the bucket's upper bound, which is
// the honest answer for a histogram and plenty precise for an ops page.
const LATENCY_BOUNDS = [25, 50, 75, 100, 150, 200, 300, 400, 500, 600, 700, 800, 1000, 1250, 1500, 2000, 3000, 5000, 7000, 10000, Infinity]

const MINUTES = 24 * 60

interface Bucket {
  minute: number
  outcomes: Record<Outcome, number>
  retried: number
  total: number[]
  upstream: number[]
  hosts: Map<string, { count: number, failed: number, latencySum: number }>
}

function emptyBucket(minute: number): Bucket {
  return {
    minute,
    outcomes: Object.fromEntries(OUTCOMES.map(o => [o, 0])) as Record<Outcome, number>,
    retried: 0,
    total: Array.from({ length: LATENCY_BOUNDS.length }, () => 0),
    upstream: Array.from({ length: LATENCY_BOUNDS.length }, () => 0),
    hosts: new Map(),
  }
}

const ring: Bucket[] = Array.from({ length: MINUTES }, () => emptyBucket(-1))
const startedAt = Date.now()

function bucketFor(now: number): Bucket {
  const minute = Math.floor(now / 60_000)
  const slot = ring[minute % MINUTES]
  if (slot.minute === minute)
    return slot
  const fresh = emptyBucket(minute)
  ring[minute % MINUTES] = fresh
  return fresh
}

function bin(ms: number) {
  return LATENCY_BOUNDS.findIndex(b => ms <= b)
}

export function recordRequest(r: {
  outcome: Outcome
  host?: string
  totalMs?: number
  upstreamMs?: number
  attempts?: number
}) {
  const b = bucketFor(Date.now())
  b.outcomes[r.outcome]++
  if ((r.attempts ?? 1) > 1)
    b.retried++
  if (r.totalMs != null)
    b.total[bin(r.totalMs)]++
  if (r.upstreamMs != null)
    b.upstream[bin(r.upstreamMs)]++
  if (r.host) {
    const h = b.hosts.get(r.host) ?? { count: 0, failed: 0, latencySum: 0 }
    h.count++
    if (r.outcome === 'failed' || r.outcome === 'serverError')
      h.failed++
    h.latencySum += r.totalMs ?? 0
    b.hosts.set(r.host, h)
  }
}

export function statusOutcome(status: number): Outcome {
  if (status >= 500)
    return 'serverError'
  if (status === 404)
    return 'notFound'
  if (status >= 400)
    return 'clientError'
  if (status >= 300)
    return 'redirect'
  return 'ok'
}

function percentile(hist: number[], q: number): number | null {
  const n = hist.reduce((a, b) => a + b, 0)
  if (!n)
    return null
  let seen = 0
  for (let i = 0; i < hist.length; i++) {
    seen += hist[i]
    if (seen >= n * q)
      return Number.isFinite(LATENCY_BOUNDS[i]) ? LATENCY_BOUNDS[i] : LATENCY_BOUNDS[i - 1]
  }
  return null
}

function addHist(into: number[], from: number[]) {
  for (let i = 0; i < from.length; i++) into[i] += from[i]
}

// Points per range stay around 60-96 so the chart is legible at any range.
const STEP_FOR_RANGE: Record<number, number> = { 60: 1, 360: 5, 1440: 15 }

export function snapshot(rangeMinutes: number, now = Date.now()) {
  const range = STEP_FOR_RANGE[rangeMinutes] ? rangeMinutes : 60
  const step = STEP_FOR_RANGE[range]
  const lastMinute = Math.floor(now / 60_000)
  const firstMinute = lastMinute - range + 1

  const totals = emptyBucket(0)
  const series: Array<{ t: number, ok: number, failed: number, other: number, p50: number | null, p90: number | null }> = []
  const hosts = new Map<string, { count: number, failed: number, latencySum: number }>()

  for (let start = firstMinute; start <= lastMinute; start += step) {
    const point = emptyBucket(start)
    for (let m = start; m < start + step && m <= lastMinute; m++) {
      const b = ring[m % MINUTES]
      if (b.minute !== m)
        continue
      for (const o of OUTCOMES) point.outcomes[o] += b.outcomes[o]
      point.retried += b.retried
      addHist(point.total, b.total)
      addHist(point.upstream, b.upstream)
      for (const [host, h] of b.hosts) {
        const acc = hosts.get(host) ?? { count: 0, failed: 0, latencySum: 0 }
        acc.count += h.count
        acc.failed += h.failed
        acc.latencySum += h.latencySum
        hosts.set(host, acc)
      }
    }
    for (const o of OUTCOMES) totals.outcomes[o] += point.outcomes[o]
    totals.retried += point.retried
    addHist(totals.total, point.total)
    addHist(totals.upstream, point.upstream)

    const o = point.outcomes
    series.push({
      t: start * 60_000,
      ok: o.ok + o.redirect,
      failed: o.failed + o.serverError,
      other: o.clientError + o.notFound + o.rejected,
      p50: percentile(point.total, 0.5),
      p90: percentile(point.total, 0.9),
    })
  }

  const o = totals.outcomes
  const requests = OUTCOMES.reduce((a, k) => a + o[k], 0)
  return {
    now,
    startedAt,
    rangeMinutes: range,
    stepMinutes: step,
    requests,
    outcomes: o,
    retried: totals.retried,
    failureRate: requests ? (o.failed + o.serverError) / requests : 0,
    latency: {
      total: { p50: percentile(totals.total, 0.5), p90: percentile(totals.total, 0.9), p99: percentile(totals.total, 0.99) },
      upstream: { p50: percentile(totals.upstream, 0.5), p90: percentile(totals.upstream, 0.9), p99: percentile(totals.upstream, 0.99) },
    },
    hosts: [...hosts.entries()]
      .map(([host, h]) => ({ host, count: h.count, failed: h.failed, avgMs: h.count ? Math.round(h.latencySum / h.count) : null }))
      .sort((a, b) => b.count - a.count),
    series,
  }
}

// test hook
export function resetStats() {
  for (let i = 0; i < ring.length; i++) ring[i] = emptyBucket(-1)
}
