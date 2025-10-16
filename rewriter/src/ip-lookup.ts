import { AreabookClient } from '@areabook/client'

let storedClient: AreabookClient | null = null

const getClient = () => {
  if (storedClient) return storedClient

  storedClient = new AreabookClient(['https://areabook.youthink.dev'], true, {
    headers: {
      authorization: `Bearer mQHom9QlY4NiquLQRuGET`
    }
  })

  return storedClient
}

type IPLookupResult = {
  ip: string
  country?: string
  city?: string
  subdivision?: string
}

const CACHE_TTL = 60 * 60 * 24 * 7 // 7 days in seconds

export const lookupIPWithCache = async (ip: string, kv: KVNamespace): Promise<IPLookupResult> => {
  // Try to get from cache first
  const cacheKey = `ip:${ip}`
  const cached = await kv.get<IPLookupResult>(cacheKey, 'json')

  if (cached) {
    return cached
  }

  // If not in cache, fetch from API
  const client = getClient()
  const response = await client.lookupIp(ip)

  const result: IPLookupResult = {
    ip,
    country: response.country?.name_ru,
    city: response.city?.name_ru,
    subdivision: response.subdivision?.name_ru,
  }

  // Store in cache with TTL
  await kv.put(cacheKey, JSON.stringify(result), {
    expirationTtl: CACHE_TTL,
  })

  return result
}