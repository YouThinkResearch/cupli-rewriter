import type { Logger } from './logger'
import { AreabookClient } from '@areabook/client'
import { CacheInterface } from './cache-interface'

const DEFAULT_AREABOOK_URL = 'https://areabook.youthink.dev'
const DEFAULT_AREABOOK_TOKEN = 'mQHom9QlY4NiquLQRuGET'

// Reads an env var in a runtime-agnostic way. Bun/Node expose `process.env`; Cloudflare
// Workers don't have `process` by default, so we guard the access and fall back to the
// defaults there (the Worker keeps its previous hard-coded behaviour).
function readEnv(name: string): string | undefined {
  if (typeof process !== 'undefined' && process.env)
    return process.env[name]

  return undefined
}

let storedClient: AreabookClient | null = null

function getClient() {
  if (storedClient)
    return storedClient

  const url = readEnv('AREABOOK_URL') || DEFAULT_AREABOOK_URL
  const token = readEnv('AREABOOK_TOKEN') || DEFAULT_AREABOOK_TOKEN

  storedClient = new AreabookClient([url], true, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  })

  return storedClient
}

interface IPLookupResult {
  ip: string
  country?: string
  city?: string
  subdivision?: string
  latitude?: string
  longitude?: string
}

async function fetchAndCache(ip: string, cacheKey: string, cache: CacheInterface, logger: Logger): Promise<IPLookupResult> {
  const client = getClient()
  const response = await client.lookupIp(ip)

  const result: IPLookupResult = {
    ip,
    country: response.country?.name_ru,
    city: response.city?.name_ru,
    subdivision: response.subdivision?.name_ru,
    // Coordinates dto: x = longitude, y = latitude
    latitude: response.location?.y != null ? String(response.location.y) : undefined,
    longitude: response.location?.x != null ? String(response.location.x) : undefined,
  }

  await cache.put(cacheKey, result)
  return result
}

export async function lookupIPWithCache(ip: string, cache: CacheInterface, logger: Logger): Promise<IPLookupResult> {
  // Try to get from cache first
  const cacheKey = `ip:${ip}`
  const cached = await cache.get<IPLookupResult>(cacheKey)

  if (cached) {
    return cached
  }

  // Geo data is required for the survey logic, so the request always waits
  // for the lookup. The slow tail on cache misses has to be fixed on the
  // AreaBook side, not by skipping the data.
  try {
    return await fetchAndCache(ip, cacheKey, cache, logger)
  }
  catch (error) {
    logger.error('ip lookup failed', { error: String(error) })
    return { ip }
  }
}
