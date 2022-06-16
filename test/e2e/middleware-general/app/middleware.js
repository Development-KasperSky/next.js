/* global globalThis, URLPattern */
import { NextRequest, NextResponse } from 'next/server'
import magicValue from 'shared-package'

const PATTERNS = [
  [
    new URLPattern({ pathname: '/:locale/:id' }),
    ({ pathname }) => ({
      pathname: '/:locale/:id',
      params: pathname.groups,
    }),
  ],
  [
    new URLPattern({ pathname: '/:id' }),
    ({ pathname }) => ({
      pathname: '/:id',
      params: pathname.groups,
    }),
  ],
]

const params = (url) => {
  const input = url.split('?')[0]
  let result = {}

  for (const [pattern, handler] of PATTERNS) {
    const patternResult = pattern.exec(input)
    if (patternResult !== null && 'pathname' in patternResult) {
      result = handler(patternResult)
      break
    }
  }
  return result
}

export async function middleware(request) {
  const url = request.nextUrl

  if (request.headers.get('x-prerender-revalidate')) {
    const res = NextResponse.next()
    res.headers.set('x-middleware', 'hi')
    return res
  }

  // this is needed for tests to get the BUILD_ID
  if (url.pathname.startsWith('/_next/static/__BUILD_ID')) {
    return NextResponse.next()
  }

  if (url.pathname === '/sha') {
    url.pathname = '/shallow'
    return NextResponse.rewrite(url)
  }

  if (url.pathname.startsWith('/fetch-user-agent-default')) {
    try {
      const apiRoute = new URL(url)
      apiRoute.pathname = '/api/headers'
      const res = await fetch(withLocalIp(apiRoute))
      return serializeData(await res.text())
    } catch (err) {
      return serializeError(err)
    }
  }

  if (url.pathname === '/rewrite-to-dynamic') {
    url.pathname = '/blog/from-middleware'
    url.searchParams.set('some', 'middleware')
    return NextResponse.rewrite(url)
  }

  if (url.pathname === '/rewrite-to-config-rewrite') {
    url.pathname = '/rewrite-3'
    url.searchParams.set('some', 'middleware')
    return NextResponse.rewrite(url)
  }

  if (url.pathname.startsWith('/fetch-user-agent-crypto')) {
    try {
      const apiRoute = new URL(url)
      apiRoute.pathname = '/api/headers'
      const res = await fetch(withLocalIp(apiRoute), {
        headers: {
          'user-agent': 'custom-agent',
        },
      })
      return serializeData(await res.text())
    } catch (err) {
      return serializeError(err)
    }
  }

  if (url.pathname === '/global') {
    // The next line is required to allow to find the env variable
    // eslint-disable-next-line no-unused-expressions
    process.env.MIDDLEWARE_TEST

    // The next line is required to allow to find the env variable
    // eslint-disable-next-line no-unused-expressions
    const { ANOTHER_MIDDLEWARE_TEST } = process.env
    if (!ANOTHER_MIDDLEWARE_TEST) {
      console.log('missing ANOTHER_MIDDLEWARE_TEST')
    }

    const { STRING_ENV_VAR: stringEnvVar } = process['env']
    if (!stringEnvVar) {
      console.log('missing STRING_ENV_VAR')
    }

    return serializeData(JSON.stringify({ process: { env: process.env } }))
  }

  if (url.pathname.endsWith('/globalthis')) {
    return serializeData(JSON.stringify(Object.keys(globalThis)))
  }

  if (url.pathname.endsWith('/webcrypto')) {
    const response = {}
    try {
      const algorithm = {
        name: 'RSA-PSS',
        hash: 'SHA-256',
        publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
        modulusLength: 2048,
      }
      const keyUsages = ['sign', 'verify']
      await crypto.subtle.generateKey(algorithm, false, keyUsages)
    } catch (err) {
      response.error = true
    } finally {
      return serializeData(JSON.stringify(response))
    }
  }

  if (url.pathname.endsWith('/fetch-url')) {
    const response = {}
    try {
      await fetch(new URL('http://localhost'))
    } catch (err) {
      response.error = {
        name: err.name,
        message: err.message,
      }
    } finally {
      return serializeData(JSON.stringify(response))
    }
  }

  if (url.pathname === '/abort-controller') {
    const controller = new AbortController()
    const signal = controller.signal

    controller.abort()
    const response = {}

    try {
      await fetch('https://example.vercel.sh', { signal })
    } catch (err) {
      response.error = {
        name: err.name,
        message: err.message,
      }
    } finally {
      return serializeData(JSON.stringify(response))
    }
  }

  if (url.pathname.endsWith('/root-subrequest')) {
    const res = await fetch(url)
    res.headers.set('x-dynamic-path', 'true')
    return res
  }

  if (url.pathname === '/about') {
    if (magicValue !== 42) throw new Error('shared-package problem')
    return NextResponse.rewrite(new URL('/about/a', request.url))
  }

  if (url.pathname.startsWith('/url')) {
    try {
      if (request.nextUrl.pathname === '/url/relative-url') {
        new URL('/relative')
        return Response.next()
      }

      if (request.nextUrl.pathname === '/url/relative-request') {
        await fetch(new Request('/urls-b'))
        return Response.next()
      }

      if (request.nextUrl.pathname === '/url/relative-redirect') {
        return Response.redirect('/urls-b')
      }

      if (request.nextUrl.pathname === '/url/relative-next-redirect') {
        return NextResponse.redirect('/urls-b')
      }

      if (request.nextUrl.pathname === '/url/relative-next-rewrite') {
        return NextResponse.rewrite('/urls-b')
      }

      if (request.nextUrl.pathname === '/url/relative-next-request') {
        await fetch(new NextRequest('/urls-b'))
        return NextResponse.next()
      }
    } catch (error) {
      return new NextResponse(null, { headers: { error: error.message } })
    }
  }

  if (url.pathname === '/ssr-page') {
    url.pathname = '/ssr-page-2'
    return NextResponse.rewrite(url)
  }

  if (url.pathname === '/error-throw' && request.__isData) {
    throw new Error('test error')
  }

  const response = NextResponse.next()
  const original = new URL(request.url)
  response.headers.set('req-url-path', `${original.pathname}${original.search}`)
  response.headers.set('req-url-basepath', request.nextUrl.basePath)
  response.headers.set('req-url-pathname', request.nextUrl.pathname)
  response.headers.set('req-url-query', request.nextUrl.searchParams.get('foo'))
  response.headers.set('req-url-locale', request.nextUrl.locale)
  response.headers.set(
    'req-url-params',
    url.pathname !== '/static' ? JSON.stringify(params(request.url)) : '{}'
  )
  return response
}

function serializeData(data) {
  return new NextResponse(null, { headers: { data } })
}

function serializeError(error) {
  return new NextResponse(null, { headers: { error: error.message } })
}

function withLocalIp(url) {
  return String(url).replace('localhost', '127.0.0.1')
}
