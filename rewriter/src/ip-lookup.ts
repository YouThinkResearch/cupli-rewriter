import { AreabookClient } from '@areabook/client'
import { CacheInterface } from './cache-interface'

let storedClient: AreabookClient | null = null

function getClient() {
  if (storedClient)
    return storedClient

  storedClient = new AreabookClient(['https://areabook.youthink.dev'], true, {
    headers: {
      authorization: `Bearer mQHom9QlY4NiquLQRuGET`,
    },
  })

  return storedClient
}

interface IPLookupResult {
  ip: string
  country?: string
  city?: string
  subdivision?: string
}

export async function lookupIPWithCache(ip: string, cache: CacheInterface): Promise<IPLookupResult> {
  // Try to get from cache first
  const cacheKey = `ip:${ip}`
  const cached = await cache.get<IPLookupResult>(cacheKey)

  if (cached) {
    return cached
  }

  // If not in cache, fetch from API
  const client = getClient()
  try {
    const response = await client.lookupIp(ip)

    const result: IPLookupResult = {
      ip,
      country: response.country?.name_ru,
      city: response.city?.name_ru,
      subdivision: response.subdivision?.name_ru,
    }

    await cache.put(cacheKey, result)
    return result
  }
  catch (error) {
    console.error('Error looking up IP:', error)
    return {
      ip,
    }
  }
}
