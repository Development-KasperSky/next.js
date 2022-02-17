import { NextResponse } from 'next/server'

/**
 * @param {import('next/server').NextRequest} request
 */
export async function middleware(request) {
  const url = request.nextUrl

  if (
    url.pathname.startsWith('/rewrites/about') &&
    url.searchParams.has('override')
  ) {
    const isExternal = url.searchParams.get('override') === 'external'
    return NextResponse.rewrite(
      isExternal ? 'https://vercel.com' : new URL('/rewrites/a', request.url)
    )
  }

  if (url.pathname.startsWith('/rewrites/to-blog')) {
    const slug = url.pathname.split('/').pop()
    url.pathname = `/rewrites/fallback-true-blog/${slug}`
    return NextResponse.rewrite(url)
  }

  if (url.pathname === '/rewrites/rewrite-to-ab-test') {
    let bucket = request.cookies.bucket
    if (!bucket) {
      bucket = Math.random() >= 0.5 ? 'a' : 'b'
      url.pathname = `/rewrites/${bucket}`
      const response = NextResponse.rewrite(url)
      response.cookie('bucket', bucket, { maxAge: 10000 })
      return response
    }

    url.pathname = `/rewrites/${bucket}`
    return NextResponse.rewrite(url)
  }

  if (url.pathname === '/rewrites/rewrite-me-to-about') {
    url.pathname = '/rewrites/about'
    return NextResponse.rewrite(url)
  }

  if (url.pathname === '/rewrites/rewrite-me-to-vercel') {
    return NextResponse.rewrite('https://vercel.com')
  }

  if (url.pathname === '/rewrites/clear-query-params') {
    const allowedKeys = ['allowed']
    for (const key of [...url.searchParams.keys()]) {
      if (!allowedKeys.includes(key)) {
        url.searchParams.delete(key)
      }
    }
    return NextResponse.rewrite(url)
  }

  if (url.pathname === '/rewrites/rewrite-me-without-hard-navigation') {
    url.searchParams.set('middleware', 'foo')
    url.pathname =
      request.cookies['about-bypass'] === '1'
        ? '/rewrites/about-bypass'
        : '/rewrites/about'

    const response = NextResponse.rewrite(url)
    response.headers.set('x-middleware-cache', 'no-cache')
    return response
  }
}
