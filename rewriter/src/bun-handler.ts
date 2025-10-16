import type { Serve } from 'bun'
import { env } from 'node:process'
import { CacheInterface } from './cache-interface'
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

// Create a global cache instance with a capacity of 1000 items
const cache = new BunLruCache(new LRUCache<string, any>(1000))

export default {
  async fetch(request): Promise<Response> {
    const relaySecretKey = request.headers.get('x-relay-secret-key')

    return rewriteRequest(request, {
      rewrittenHosts: typeof env.REWRITTEN_HOSTS === 'string' ? JSON.parse(env.REWRITTEN_HOSTS) : env.REWRITTEN_HOSTS,
      proxyHost: env.PROXY_HOST ?? '',
      relaySecretKey: env.RELAY_SECRET_KEY ?? '',
    }, cache)
  },
} satisfies Serve
