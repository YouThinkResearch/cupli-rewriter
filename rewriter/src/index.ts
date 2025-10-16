import { CacheInterface } from './cache-interface'
import rewriteRequest, { RewrittenHost } from './rewrite-request'

function parseRewrittenHosts(hosts: (string | RewrittenHost)[]): RewrittenHost[] {
  return hosts.map((host) => {
    if (typeof host === 'string') {
      return [host, undefined]
    }

    // that's temporairly until changes propagate to the CDN
    return host
  })
}

class CloudflareR2Cache implements CacheInterface {
  constructor(private readonly kv: KVNamespace) { }

  async get<T>(key: string): Promise<T | null> {
    const value = await this.kv.get<T>(key)
    return value ?? null
  }

  async put<T>(key: string, value: T): Promise<void> {
    return this.kv.put(key, JSON.stringify(value), {
      expirationTtl: 60 * 60 * 24 * 7, // 7 days
    })
  }
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const relaySecretKey = request.headers.get('x-relay-secret-key')

    if (relaySecretKey !== env.RELAY_SECRET_KEY) {
      return new Response('Unauthorized', { status: 401 })
    }

    return rewriteRequest(request, {
      rewrittenHosts: parseRewrittenHosts(typeof env.REWRITTEN_HOSTS === 'string' ? JSON.parse(env.REWRITTEN_HOSTS) : env.REWRITTEN_HOSTS),
      proxyHost: env.PROXY_HOST,
      relaySecretKey: env.RELAY_SECRET_KEY,
    }, new CloudflareR2Cache(env.IP_LOOKUP_CACHE))
  },
} satisfies ExportedHandler<Env>
