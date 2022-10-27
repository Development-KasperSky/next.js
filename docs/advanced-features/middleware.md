---
description: Learn how to use Middleware to run code before a request is completed.
---

# Middleware

<details open>
<summary><b>Version History</b></summary>

| Version   | Changes                                                                                    |
| --------- | ------------------------------------------------------------------------------------------ |
| `v12.2.0` | Middleware is stable                                                                       |
| `v12.0.9` | Enforce absolute URLs in Edge Runtime ([PR](https://github.com/vercel/next.js/pull/33410)) |
| `v12.0.0` | Middleware (Beta) added                                                                    |

</details>

Middleware allows you to run code before a request is completed, then based on the incoming request, you can modify the response by rewriting, redirecting, adding headers, or setting cookies.

Middleware runs _before_ cached content, so you can personalize static files and pages. Common examples of Middleware would be authentication, A/B testing, localized pages, bot protection, and more. Regarding localized pages, you can start with [i18n routing](/docs/advanced-features/i18n-routing) and implement Middleware for more advanced use cases.

> **Note:** If you were using Middleware prior to `12.2`, please see the [upgrade guide](https://nextjs.org/docs/messages/middleware-upgrade-guide).

## Using Middleware

To begin using Middleware, follow the steps below:

1. Install the latest version of Next.js:

```bash
npm install next@latest
```

2. Create a `middleware.ts` (or `.js`) file at the root or in the `src` directory (same level as your `pages`)
3. Export a middleware function from the `middleware.ts` file:

```typescript
// middleware.ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// This function can be marked `async` if using `await` inside
export function middleware(request: NextRequest) {
  return NextResponse.redirect(new URL('/about-2', request.url))
}

// See "Matching Paths" below to learn more
export const config = {
  matcher: '/about/:path*',
}
```

## Matching Paths

Middleware will be invoked for **every route in your project**. The following is the execution order:

1. `headers` from `next.config.js`
2. `redirects` from `next.config.js`
3. Middleware (`rewrites`, `redirects`, etc.)
4. `beforeFiles` (`rewrites`) from `next.config.js`
5. Filesystem routes (`public/`, `_next/static/`, Pages, etc.)
6. `afterFiles` (`rewrites`) from `next.config.js`
7. Dynamic Routes (`/blog/[slug]`)
8. `fallback` (`rewrites`) from `next.config.js`

There are two ways to define which paths Middleware will run on:

1. Custom matcher config
2. Conditional statements

### Matcher

`matcher` allows you to filter Middleware to run on specific paths.

```js
export const config = {
  matcher: '/about/:path*',
}
```

You can match a single path or multiple paths with an array syntax:

```js
export const config = {
  matcher: ['/about/:path*', '/dashboard/:path*'],
}
```

The `matcher` config allows full regex so matching like negative lookaheads or character matching is supported. An example of a negative lookahead to match all except specific paths can be seen here:

```js
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - static (static files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|static|favicon.ico).*)',
  ],
}
```

> **Note:** The `matcher` values need to be constants so they can be statically analyzed at build-time. Dynamic values such as variables will be ignored.

Configured matchers:

1. MUST start with `/`
2. Can include named parameters: `/about/:path` matches `/about/a` and `/about/b` but not `/about/a/c`
3. Can have modifiers on named parameters (starting with `:`): `/about/:path*` matches `/about/a/b/c` because `*` is _zero or more_. `?` is _zero or one_ and `+` _one or more_
4. Can use regular expression enclosed in parenthesis: `/about/(.*)` is the same as `/about/:path*`

Read more details on [path-to-regexp](https://github.com/pillarjs/path-to-regexp#path-to-regexp-1) documentation.

> **Note:** For backward compatibility, Next.js always considers `/public` as `/public/index`. Therefore, a matcher of `/public/:path` will match.

### Conditional Statements

```typescript
// middleware.ts

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/about')) {
    return NextResponse.rewrite(new URL('/about-2', request.url))
  }

  if (request.nextUrl.pathname.startsWith('/dashboard')) {
    return NextResponse.rewrite(new URL('/dashboard/user', request.url))
  }
}
```

## NextResponse

The [`NextResponse`](#nextresponse) API allows you to:

- `redirect` the incoming request to a different URL
- `rewrite` the response by displaying a given URL
- Set request headers for API Routes, `getServerSideProps`, and `rewrite` destinations
- Set response cookies
- Set response headers

To produce a response from Middleware, you should `rewrite` to a route ([Page](/docs/basic-features/pages.md) or [Edge API Route](/docs/api-routes/edge-api-routes.md)) that produces a response.

## Using Cookies

Cookies are regular headers. On a `Request`, they are stored in the `Cookie` header. On a `Response` they are in the `Set-Cookie` header. Next.js provides a convenient way to access and manipulate these cookies through the `cookies` extension on `NextRequest` and `NextResponse`.

1. For incoming requests, `cookies` comes with the following methods: `get`, `getAll`, `set`, and `delete` cookies. You can check for the existence of a cookie with `has` or remove all cookies with `clear`.
2. For outgoing responses, `cookies` have the following methods `get`, `getAll`, `set`, and `delete`.

```typescript
// middleware.ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // Assume a "Cookie:vercel=fast" header to be present on the incoming request
  // Getting cookies from the request using the `RequestCookies` API
  const cookie = request.cookies.get('nextjs')?.value
  console.log(cookie) // => 'fast'
  const allCookies = request.cookies.getAll()
  console.log(allCookies) // => [{ name: 'vercel', value: 'fast' }]

  response.cookies.has('nextjs') // => true
  response.cookies.delete('nextjs')
  response.cookies.has('nextjs') // => false

  // Setting cookies on the response using the `ResponseCookies` API
  const response = NextResponse.next()
  response.cookies.set('vercel', 'fast')
  response.cookies.set({
    name: 'vercel',
    value: 'fast',
    path: '/test',
  })
  const cookie = response.cookies.get('vercel')
  console.log(cookie) // => { name: 'vercel', value: 'fast', Path: '/test' }
  // The outgoing response will have a `Set-Cookie:vercel=fast;path=/test` header.

  return response
}
```

## Setting Headers

You can set request and response headers using the `NextResponse` API.

```ts
// middleware.ts

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // Clone the request headers and set a new header `x-hello-from-middleware1`
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-hello-from-middleware1', 'hello')

  // You can also set request headers in NextResponse.rewrite
  const response = NextResponse.next({
    request: {
      // New request headers
      headers: requestHeaders,
    },
  })

  // Set a new response header `x-hello-from-middleware2`
  response.headers.set('x-hello-from-middleware2', 'hello')
  return response
}
```

> **Note:** Avoid setting large headers as it might cause [431 Request Header Fields Too Large](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/431) error depending on your backend web server configuration.

## Related

<div class="card">
  <a href="/docs/api-reference/edge-runtime.md">
    <b>Edge Runtime</b>
    <small>Learn more about the supported Web APIs available.</small>
  </a>
</div>

<div class="card">
  <a href="/docs/api-reference/next/server.md">
    <b>Middleware API Reference</b>
    <small>Learn more about the supported APIs for Middleware.</small>
  </a>
</div>

<div class="card">
  <a href="/docs/api-routes/edge-api-routes.md">
    <b>Edge API Routes</b>
    <small>Build high performance APIs in Next.js. </small>
  </a>
</div>
