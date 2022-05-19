import { NextMiddleware, NextResponse } from 'next/server'

export const middleware: NextMiddleware = function (request) {
  if (request.nextUrl.pathname === '/static') {
    return new NextResponse('hello from middleware', {
      headers: {
        'req-url-basepath': request.nextUrl.basePath,
        'req-url-pathname': request.nextUrl.pathname,
        'req-url-params': JSON.stringify(request.page.params),
        'req-url-page': request.page.name || '',
        'req-url-query': request.nextUrl.searchParams.get('foo') || '',
        'req-url-locale': request.nextUrl.locale,
      },
    })
  }
}
