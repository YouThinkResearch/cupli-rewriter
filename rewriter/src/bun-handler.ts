import type { Serve } from 'bun'
import { env } from 'node:process'
import { RedisClient } from 'bun'
import { CacheInterface } from './cache-interface'
import { log } from './logger'
import { LRUCache } from './lru-cache'
import rewriteRequest from './rewrite-request'

export class BunLruCache implements CacheInterface {
  constructor(private readonly lru: LRUCache<string, any>) { }

  async get<T>(key: string): Promise<T | null> {
    return this.lru.get(key) ?? null
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.lru.set(key, value)
  }
}

const CACHE_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days, matches the Workers KV cache

// Redis keeps survey-session form data alive across deploys/restarts; errors
// degrade to cache misses so a Redis outage never takes the proxy down.
export class BunRedisCache implements CacheInterface {
  constructor(private readonly client: RedisClient) { }

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.client.get(key)
      return value === null ? null : JSON.parse(value) as T
    }
    catch (error) {
      log.warn('redis get failed', { key, error: String(error) })
      return null
    }
  }

  async put<T>(key: string, value: T): Promise<void> {
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS)
    }
    catch (error) {
      log.warn('redis put failed', { key, error: String(error) })
    }
  }
}

const cache: CacheInterface = env.REDIS_URL
  ? new BunRedisCache(new RedisClient(env.REDIS_URL))
  : new BunLruCache(new LRUCache<string, any>(1000)) // in-memory fallback (dev/tests)

if (!env.REDIS_URL)
  log.warn('REDIS_URL not set, using in-memory cache; survey sessions will not survive restarts')

export default {
  async fetch(request): Promise<Response> {
    log.debug('incoming request', { url: request.url })

    return rewriteRequest(request, {
      rewrittenHosts: typeof env.REWRITTEN_HOSTS === 'string' ? JSON.parse(env.REWRITTEN_HOSTS) : env.REWRITTEN_HOSTS,
      proxyHost: env.PROXY_HOST ?? '',
      relaySecretKey: env.RELAY_SECRET_KEY ?? '',
    }, cache)
  },
} satisfies Serve
