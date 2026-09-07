import { describe, expect, it } from 'vitest'
import { staticCacheControl } from '../src/rewrite-request'

describe('staticCacheControl', () => {
  it('caches versioned runtime bundles forever', () => {
    expect(staticCacheControl('text/css', '/2026.09.04.00/runtimejs/dist/survey/css/survey2.css'))
      .toBe('public, max-age=31536000, immutable')
    expect(staticCacheControl('application/javascript', '/2026.09.01.02/runtimejs/dist/survey/js/surveymobile.js'))
      .toBe('public, max-age=31536000, immutable')
  })

  it('caches unversioned media for a day', () => {
    expect(staticCacheControl('image/jpeg', '/library/343438/sevensky1.jpg'))
      .toBe('public, max-age=86400')
    expect(staticCacheControl('font/woff2', '/themes/fonts/icons.woff2'))
      .toBe('public, max-age=86400')
  })

  // The whole point of the content-type gate: survey pages are per-session, and
  // caching one would serve another respondent's answers.
  it('never caches survey documents', () => {
    expect(staticCacheControl('text/html; charset=utf-8', '/s3/8580102/')).toBeNull()
    expect(staticCacheControl('application/json', '/api/answers')).toBeNull()
    expect(staticCacheControl('', '/s3/8580102/')).toBeNull()
  })

  it('does not treat a versioned html path as immutable', () => {
    expect(staticCacheControl('text/html', '/2026.09.04.00/index.html')).toBeNull()
  })
})
