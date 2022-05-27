import type { NextPathnameInfo } from './get-next-pathname-info'
import { addPathPrefix } from './add-path-prefix'
import { addPathSuffix } from './add-path-suffix'
import { addLocale } from './add-locale'

interface ExtendedInfo extends NextPathnameInfo {
  defaultLocale?: string
}

export function formatNextPathnameInfo(info: ExtendedInfo) {
  let pathname = addLocale(
    info.pathname,
    info.locale,
    info.buildId ? undefined : info.defaultLocale
  )

  if (info.buildId) {
    pathname = addPathSuffix(
      addPathPrefix(pathname, `/_next/data/${info.buildId}`),
      info.pathname === '/' ? 'index.json' : '.json'
    )
  }

  pathname = addPathPrefix(pathname, info.basePath)
  return info.trailingSlash && !info.buildId && !pathname.endsWith('/')
    ? addPathSuffix(pathname, '/')
    : pathname
}
