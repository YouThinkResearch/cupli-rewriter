// In-memory request metrics behind /.well-known/ip-stats.
//
// Per-minute buckets for the last 24h in a ring, each holding outcome counters, a
// latency histogram and per-host counts. Aggregates only - no client IPs, no paths.
// Kept in memory for speed and persisted per minute to a StatsStore (Redis in prod, see
// persistence below) so restarts and deploys do not drop history.

export type Outcome =
  | 'ok' // 2xx from upstream
  | 'redirect' // 3xx from upstream
  | 'clientError' // 4xx other than 404 (e.g. Alchemer's 403s)
  | 'notFound' // upstream 404
  | 'serverError' // 5xx from upstream after retries
  | 'failed' // every attempt failed: retry page or our own 502
  | 'rejected' // no/invalid forwarded headers, unknown host

const OUTCOMES: Outcome[] = ['ok', 'redirect', 'clientError', 'notFound', 'serverError', 'failed', 'rejected']

// Latency is a fine log-scale histogram: bins grow by 2%, so a percentile is reported
// within ~1% of the true value (the geometric middle of its bin), recording is O(1) and
// memory is fixed regardless of traffic. Peaks reach ~2M requests in a couple of hours
// (~16k/min): raw samples would either be capped - keeping only the first N of each
// minute, a biased sample - or cost a multi-million-element sort on every page poll.
// The earlier coarse 100ms bins reported every value as its bin edge (450 -> "500 ms").
const GROWTH = 1.02
const MAX_MS = 120_000
const BINS = Math.ceil(Math.log(MAX_MS) / Math.log(GROWTH)) + 2 // ~595

function binOf(ms: number) {
  if (ms < 1)
    return 0
  return Math.min(BINS - 1, 1 + Math.floor(Math.log(ms) / Math.log(GROWTH)))
}

// geometric middle of the bin, i.e. within 1% of anything that landed in it
function valueOf(bin: number) {
  if (bin === 0)
    return 0
  return Math.round(GROWTH ** (bin - 1) * Math.sqrt(GROWTH))
}

const MINUTES = 24 * 60

interface Bucket {
  minute: number
  outcomes: Record<Outcome, number>
  retried: number
  total: Uint32Array // latency histogram, see binOf
  upstream: Uint32Array
  hosts: Map<string, { count: number, failed: number, latencySum: number }>
}

function emptyBucket(minute: number): Bucket {
  return {
    minute,
    outcomes: Object.fromEntries(OUTCOMES.map(o => [o, 0])) as Record<Outcome, number>,
    retried: 0,
    total: new Uint32Array(BINS),
    upstream: new Uint32Array(BINS),
    hosts: new Map(),
  }
}

const ring: Bucket[] = Array.from({ length: MINUTES }, () => emptyBucket(-1))
let startedAt = Date.now()

function bucketFor(now: number): Bucket {
  const minute = Math.floor(now / 60_000)
  const slot = ring[minute % MINUTES]
  if (slot.minute === minute)
    return slot
  const fresh = emptyBucket(minute)
  ring[minute % MINUTES] = fresh
  return fresh
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
    b.total[binOf(r.totalMs)]++
  if (r.upstreamMs != null)
    b.upstream[binOf(r.upstreamMs)]++
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

// Nearest-rank percentile over the histogram.
function percentile(hist: Uint32Array, q: number): number | null {
  let n = 0
  for (let i = 0; i < hist.length; i++) n += hist[i]
  if (!n)
    return null
  const rank = Math.ceil(q * n)
  let seen = 0
  for (let i = 0; i < hist.length; i++) {
    seen += hist[i]
    if (seen >= rank)
      return valueOf(i)
  }
  return null
}

function addSamples(into: Uint32Array, from: Uint32Array) {
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
      addSamples(point.total, b.total)
      addSamples(point.upstream, b.upstream)
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
    addSamples(totals.total, point.total)
    addSamples(totals.upstream, point.upstream)

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

// ---------------------------------------------------------------------------------
// Persistence. One key per minute, sparse histograms, TTL just past the 24h window.
// Flushed every 15s and on shutdown (current + previous minute, which covers the
// rollover), so a hard crash loses at most ~15s. Loaded once at startup; minutes that
// already collected data before the load finished are merged, not overwritten.
// ---------------------------------------------------------------------------------
export interface StatsStore {
  mget: (keys: string[]) => Promise<Array<string | null>>
  set: (key: string, value: string, ttlSeconds: number) => Promise<void>
  setnx: (key: string, value: string) => Promise<string | null> // returns the stored value
}

const KEY = (minute: number) => `ipstats:m:${minute}`
const TTL_SECONDS = 25 * 60 * 60

function encode(b: Bucket): string {
  const sparse = (h: Uint32Array) => {
    const out: number[] = []
    for (let i = 0; i < h.length; i++) if (h[i]) out.push(i, h[i])
    return out
  }
  return JSON.stringify({ o: b.outcomes, r: b.retried, t: sparse(b.total), u: sparse(b.upstream), h: [...b.hosts] })
}

function mergeEncoded(into: Bucket, raw: string) {
  const d = JSON.parse(raw)
  for (const o of OUTCOMES) into.outcomes[o] += d.o?.[o] ?? 0
  into.retried += d.r ?? 0
  for (let i = 0; i < (d.t?.length ?? 0); i += 2) into.total[d.t[i]] += d.t[i + 1]
  for (let i = 0; i < (d.u?.length ?? 0); i += 2) into.upstream[d.u[i]] += d.u[i + 1]
  for (const [host, h] of d.h ?? []) {
    const acc = into.hosts.get(host) ?? { count: 0, failed: 0, latencySum: 0 }
    acc.count += h.count
    acc.failed += h.failed
    acc.latencySum += h.latencySum
    into.hosts.set(host, acc)
  }
}

export async function loadStats(store: StatsStore, now = Date.now()) {
  const last = Math.floor(now / 60_000)
  const minutes = Array.from({ length: MINUTES }, (_, i) => last - MINUTES + 1 + i)
  const values = await store.mget(minutes.map(KEY))
  minutes.forEach((m, i) => {
    const raw = values[i]
    if (!raw)
      return
    const slot = ring[m % MINUTES]
    const target = slot.minute === m ? slot : (ring[m % MINUTES] = emptyBucket(m))
    mergeEncoded(target, raw)
  })
  const first = await store.setnx('ipstats:startedAt', String(startedAt))
  if (first)
    startedAt = Number(first)
}

export async function flushStats(store: StatsStore, now = Date.now()) {
  const m = Math.floor(now / 60_000)
  for (const minute of [m - 1, m]) {
    const b = ring[minute % MINUTES]
    if (b.minute === minute)
      await store.set(KEY(minute), encode(b), TTL_SECONDS)
  }
}
