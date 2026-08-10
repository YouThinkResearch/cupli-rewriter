import type { CacheInterface } from './cache-interface'
import { log } from './logger'

// Alchemer keeps survey progress server-side, keyed by the sg_sessionid field
// embedded in every page's form data (not in cookies). Storing the last
// submitted form body per (rewriter session, survey path) therefore lets us
// restore a participant: replaying that POST returns the page right after
// their last answered one.

export const SURVEY_PATH_REGEX = /^\/s3\/\d+/
const FORM_CONTENT_TYPES = /multipart\/form-data|application\/x-www-form-urlencoded/i

export interface StoredSubmission {
  bodyB64: string
  contentType: string
  storedAt: number
}

export interface Submission {
  body: ArrayBuffer
  contentType: string
}

function storageKey(sessionId: string, path: string) {
  return `survey-form:${sessionId}:${path}`
}

// btoa/atob operate on byte strings; chunk to stay under argument limits
function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk)
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

function base64ToBytes(b64: string): ArrayBuffer {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++)
    bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

export function isStorableSubmission(method: string, contentType: string | null): boolean {
  return method === 'POST' && !!contentType && FORM_CONTENT_TYPES.test(contentType)
}

export async function storeSubmission(cache: CacheInterface, sessionId: string, path: string, body: ArrayBuffer, contentType: string): Promise<void> {
  try {
    const value: StoredSubmission = { bodyB64: bytesToBase64(body), contentType, storedAt: Date.now() }
    await cache.put(storageKey(sessionId, path), value)
  }
  catch (error) {
    log.warn('failed to store survey submission', { sessionId, path, error: String(error) })
  }
}

export async function loadSubmission(cache: CacheInterface, sessionId: string, path: string): Promise<Submission | null> {
  try {
    const value = await cache.get<StoredSubmission>(storageKey(sessionId, path))
    if (!value?.bodyB64 || !value.contentType)
      return null
    return { body: base64ToBytes(value.bodyB64), contentType: value.contentType }
  }
  catch (error) {
    log.warn('failed to load survey submission', { sessionId, path, error: String(error) })
    return null
  }
}

export async function clearSubmission(cache: CacheInterface, sessionId: string, path: string): Promise<void> {
  try {
    // CacheInterface has no delete; a null tombstone reads back as missing
    await cache.put(storageKey(sessionId, path), null)
  }
  catch (error) {
    log.warn('failed to clear survey submission', { sessionId, path, error: String(error) })
  }
}
