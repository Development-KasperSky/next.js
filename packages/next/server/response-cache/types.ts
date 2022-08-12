import type RenderResult from '../render-result'

export interface ResponseCacheBase {
  get(
    key: string | null,
    responseGenerator: ResponseGenerator,
    context: {
      isManualRevalidate?: boolean
      isPrefetch?: boolean
    }
  ): Promise<ResponseCacheEntry | null>
}

export interface CachedRedirectValue {
  kind: 'REDIRECT'
  props: Object
}

interface CachedPageValue {
  kind: 'PAGE'
  // this needs to be a RenderResult so since renderResponse
  // expects that type instead of a string
  html: RenderResult
  pageData: Object
}

export interface CachedImageValue {
  kind: 'IMAGE'
  etag: string
  buffer: Buffer
  extension: string
  isMiss?: boolean
  isStale?: boolean
}

interface IncrementalCachedPageValue {
  kind: 'PAGE'
  // this needs to be a string since the cache expects to store
  // the string value
  html: string
  pageData: Object
}

export type IncrementalCacheEntry = {
  curRevalidate?: number | false
  // milliseconds to revalidate after
  revalidateAfter: number | false
  isStale?: boolean
  value: IncrementalCacheValue | null
}

export type IncrementalCacheValue =
  | CachedRedirectValue
  | IncrementalCachedPageValue
  | CachedImageValue

export type ResponseCacheValue =
  | CachedRedirectValue
  | CachedPageValue
  | CachedImageValue

export type ResponseCacheEntry = {
  revalidate?: number | false
  value: ResponseCacheValue | null
  isStale?: boolean
  isMiss?: boolean
}

export type ResponseGenerator = (
  hasResolved: boolean,
  hadCache: boolean
) => Promise<ResponseCacheEntry | null>

export type IncrementalCacheItem = {
  revalidateAfter?: number | false
  curRevalidate?: number | false
  revalidate?: number | false
  value: IncrementalCacheValue | null
  isStale?: boolean
  isMiss?: boolean
} | null

export interface IncrementalCache {
  get: (key: string) => Promise<IncrementalCacheItem>
  set: (
    key: string,
    data: IncrementalCacheValue | null,
    revalidate?: number | false
  ) => Promise<void>
}
