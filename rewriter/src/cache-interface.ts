export interface CacheInterface {
  get: <T>(key: string) => Promise<T | null>
  put: <T>(key: string, value: T) => Promise<void>
}
