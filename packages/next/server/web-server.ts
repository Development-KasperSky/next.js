import type { WebNextRequest, WebNextResponse } from './base-http/web'
import type { RenderOpts } from './render'
import type RenderResult from './render-result'
import type { NextParsedUrlQuery, NextUrlWithParsedQuery } from './request-meta'
import type { Params } from '../shared/lib/router/utils/route-matcher'
import type { PayloadOptions } from './send-payload'
import type { LoadComponentsReturnType } from './load-components'
import { NoFallbackError, Options } from './base-server'
import type { DynamicRoutes, PageChecker, Route } from './router'
import type { NextConfig } from './config-shared'
import type { BaseNextRequest, BaseNextResponse } from './base-http'
import type { UrlWithParsedQuery } from 'url'

import BaseServer from './base-server'
import { byteLength } from './api-utils/web'
import { generateETag } from './lib/etag'
import { addRequestMeta } from './request-meta'
import WebResponseCache from './response-cache/web'
import { getPathMatch } from '../shared/lib/router/utils/path-match'
import getRouteFromAssetPath from '../shared/lib/router/utils/get-route-from-asset-path'
import { detectDomainLocale } from '../shared/lib/i18n/detect-domain-locale'
import { normalizeLocalePath } from '../shared/lib/i18n/normalize-locale-path'
import { removeTrailingSlash } from '../shared/lib/router/utils/remove-trailing-slash'
import { isDynamicRoute } from '../shared/lib/router/utils'
import {
  interpolateDynamicPath,
  normalizeVercelUrl,
} from '../build/webpack/loaders/next-serverless-loader/utils'
import { getNamedRouteRegex } from '../shared/lib/router/utils/route-regex'

interface WebServerOptions extends Options {
  webServerConfig: {
    page: string
    pagesType: 'app' | 'pages' | 'root'
    loadComponent: (
      pathname: string
    ) => Promise<LoadComponentsReturnType | null>
    extendRenderOpts: Partial<BaseServer['renderOpts']> &
      Pick<BaseServer['renderOpts'], 'buildId'>
    pagesRenderToHTML?: typeof import('./render').renderToHTML
    appRenderToHTML?: typeof import('./app-render').renderToHTMLOrFlight
  }
}

export default class NextWebServer extends BaseServer<WebServerOptions> {
  constructor(options: WebServerOptions) {
    super(options)

    // Extend `renderOpts`.
    Object.assign(this.renderOpts, options.webServerConfig.extendRenderOpts)
  }

  protected handleCompression() {
    // For the web server layer, compression is automatically handled by the
    // upstream proxy (edge runtime or node server) and we can simply skip here.
  }
  protected getResponseCache() {
    return new WebResponseCache(this.minimalMode)
  }
  protected getCustomRoutes() {
    return {
      headers: [],
      rewrites: {
        fallback: [],
        afterFiles: [],
        beforeFiles: [],
      },
      redirects: [],
    }
  }
  protected async run(
    req: BaseNextRequest,
    res: BaseNextResponse,
    parsedUrl: UrlWithParsedQuery
  ): Promise<void> {
    super.run(req, res, parsedUrl)
  }
  protected async hasPage(page: string) {
    return page === this.serverOptions.webServerConfig.page
  }
  protected getPublicDir() {
    // Public files are not handled by the web server.
    return ''
  }
  protected getBuildId() {
    return this.serverOptions.webServerConfig.extendRenderOpts.buildId
  }
  protected loadEnvConfig() {
    // The web server does not need to load the env config. This is done by the
    // runtime already.
  }
  protected getHasAppDir() {
    return this.serverOptions.webServerConfig.pagesType === 'app'
  }
  protected getHasStaticDir() {
    return false
  }
  protected async getFallback() {
    return ''
  }
  protected getFontManifest() {
    return undefined
  }
  protected getPagesManifest() {
    return {
      [this.serverOptions.webServerConfig.page]: '',
    }
  }
  protected getAppPathsManifest() {
    return {
      [this.serverOptions.webServerConfig.page]: '',
    }
  }
  protected getFilesystemPaths() {
    return new Set<string>()
  }
  protected attachRequestMeta(
    req: WebNextRequest,
    parsedUrl: NextUrlWithParsedQuery
  ) {
    addRequestMeta(req, '__NEXT_INIT_QUERY', { ...parsedUrl.query })
  }
  protected getPrerenderManifest() {
    return {
      version: 3 as const,
      routes: {},
      dynamicRoutes: {},
      notFoundRoutes: [],
      preview: {
        previewModeId: '',
        previewModeSigningKey: '',
        previewModeEncryptionKey: '',
      },
    }
  }
  protected getServerComponentManifest() {
    return this.serverOptions.webServerConfig.extendRenderOpts
      .serverComponentManifest
  }
  protected getServerCSSManifest() {
    return this.serverOptions.webServerConfig.extendRenderOpts.serverCSSManifest
  }

  protected getFontLoaderManifest() {
    return this.serverOptions.webServerConfig.extendRenderOpts
      .fontLoaderManifest
  }

  protected generateRoutes(): {
    headers: Route[]
    rewrites: {
      beforeFiles: Route[]
      afterFiles: Route[]
      fallback: Route[]
    }
    fsRoutes: Route[]
    redirects: Route[]
    catchAllRoute: Route
    catchAllMiddleware: Route[]
    pageChecker: PageChecker
    useFileSystemPublicRoutes: boolean
    dynamicRoutes: DynamicRoutes | undefined
    nextConfig: NextConfig
  } {
    const fsRoutes: Route[] = [
      {
        match: getPathMatch('/_next/data/:path*'),
        type: 'route',
        name: '_next/data catchall',
        check: true,
        fn: async (req, res, params, _parsedUrl) => {
          // Make sure to 404 for /_next/data/ itself and
          // we also want to 404 if the buildId isn't correct
          if (!params.path || params.path[0] !== this.buildId) {
            await this.render404(req, res, _parsedUrl)
            return {
              finished: true,
            }
          }
          // remove buildId from URL
          params.path.shift()

          const lastParam = params.path[params.path.length - 1]

          // show 404 if it doesn't end with .json
          if (typeof lastParam !== 'string' || !lastParam.endsWith('.json')) {
            await this.render404(req, res, _parsedUrl)
            return {
              finished: true,
            }
          }

          // re-create page's pathname
          let pathname = `/${params.path.join('/')}`
          pathname = getRouteFromAssetPath(pathname, '.json')

          // ensure trailing slash is normalized per config
          if (this.router.catchAllMiddleware[0]) {
            if (this.nextConfig.trailingSlash && !pathname.endsWith('/')) {
              pathname += '/'
            }
            if (
              !this.nextConfig.trailingSlash &&
              pathname.length > 1 &&
              pathname.endsWith('/')
            ) {
              pathname = pathname.substring(0, pathname.length - 1)
            }
          }

          if (this.nextConfig.i18n) {
            const { host } = req?.headers || {}
            // remove port from host and remove port if present
            const hostname = host?.split(':')[0].toLowerCase()
            const localePathResult = normalizeLocalePath(
              pathname,
              this.nextConfig.i18n.locales
            )
            const { defaultLocale } =
              detectDomainLocale(this.nextConfig.i18n.domains, hostname) || {}

            let detectedLocale = ''

            if (localePathResult.detectedLocale) {
              pathname = localePathResult.pathname
              detectedLocale = localePathResult.detectedLocale
            }

            _parsedUrl.query.__nextLocale = detectedLocale
            _parsedUrl.query.__nextDefaultLocale =
              defaultLocale || this.nextConfig.i18n.defaultLocale

            if (!detectedLocale && !this.router.catchAllMiddleware[0]) {
              _parsedUrl.query.__nextLocale =
                _parsedUrl.query.__nextDefaultLocale
              await this.render404(req, res, _parsedUrl)
              return { finished: true }
            }
          }

          return {
            pathname,
            query: { ..._parsedUrl.query, __nextDataReq: '1' },
            finished: false,
          }
        },
      },
      {
        match: getPathMatch('/_next/:path*'),
        type: 'route',
        name: '_next catchall',
        // This path is needed because `render()` does a check for `/_next` and the calls the routing again
        fn: async (req, res, _params, parsedUrl) => {
          await this.render404(req, res, parsedUrl)
          return {
            finished: true,
          }
        },
      },
    ]

    const catchAllRoute: Route = {
      match: getPathMatch('/:path*'),
      type: 'route',
      matchesLocale: true,
      name: 'Catchall render',
      fn: async (req, res, _params, parsedUrl) => {
        let { pathname, query } = parsedUrl
        if (!pathname) {
          throw new Error('pathname is undefined')
        }

        // interpolate query information into page for dynamic route
        // so that rewritten paths are handled properly
        if (pathname !== this.serverOptions.webServerConfig.page) {
          pathname = this.serverOptions.webServerConfig.page

          if (isDynamicRoute(pathname)) {
            const routeRegex = getNamedRouteRegex(pathname)
            pathname = interpolateDynamicPath(pathname, query, routeRegex)
            normalizeVercelUrl(
              req,
              true,
              Object.keys(routeRegex.routeKeys),
              true,
              routeRegex
            )
          }
        }

        // next.js core assumes page path without trailing slash
        pathname = removeTrailingSlash(pathname)

        if (this.nextConfig.i18n) {
          const localePathResult = normalizeLocalePath(
            pathname,
            this.nextConfig.i18n?.locales
          )

          if (localePathResult.detectedLocale) {
            pathname = localePathResult.pathname
            parsedUrl.query.__nextLocale = localePathResult.detectedLocale
          }
        }
        const bubbleNoFallback = !!query._nextBubbleNoFallback

        if (pathname === '/api' || pathname.startsWith('/api/')) {
          delete query._nextBubbleNoFallback
        }

        try {
          await this.render(req, res, pathname, query, parsedUrl, true)

          return {
            finished: true,
          }
        } catch (err) {
          if (err instanceof NoFallbackError && bubbleNoFallback) {
            return {
              finished: false,
            }
          }
          throw err
        }
      },
    }

    const { useFileSystemPublicRoutes } = this.nextConfig

    if (useFileSystemPublicRoutes) {
      this.appPathRoutes = this.getAppPathRoutes()
      this.dynamicRoutes = this.getDynamicRoutes()
    }

    return {
      headers: [],
      fsRoutes,
      rewrites: {
        beforeFiles: [],
        afterFiles: [],
        fallback: [],
      },
      redirects: [],
      catchAllRoute,
      catchAllMiddleware: [],
      useFileSystemPublicRoutes,
      dynamicRoutes: this.dynamicRoutes,
      pageChecker: this.hasPage.bind(this),
      nextConfig: this.nextConfig,
    }
  }

  // Edge API requests are handled separately in minimal mode.
  protected async handleApiRequest() {
    return false
  }
  protected async renderHTML(
    req: WebNextRequest,
    _res: WebNextResponse,
    pathname: string,
    query: NextParsedUrlQuery,
    renderOpts: RenderOpts
  ): Promise<RenderResult | null> {
    const { pagesRenderToHTML, appRenderToHTML } =
      this.serverOptions.webServerConfig
    const curRenderToHTML = pagesRenderToHTML || appRenderToHTML

    if (curRenderToHTML) {
      return await curRenderToHTML(
        {
          url: req.url,
          cookies: req.cookies,
          headers: req.headers,
        } as any,
        {} as any,
        pathname,
        query,
        Object.assign(renderOpts, {
          disableOptimizedLoading: true,
          runtime: 'experimental-edge',
        }),
        !!pagesRenderToHTML
      )
    } else {
      throw new Error(`Invariant: curRenderToHTML is missing`)
    }
  }
  protected async sendRenderResult(
    _req: WebNextRequest,
    res: WebNextResponse,
    options: {
      result: RenderResult
      type: 'html' | 'json'
      generateEtags: boolean
      poweredByHeader: boolean
      options?: PayloadOptions | undefined
    }
  ): Promise<void> {
    res.setHeader('X-Edge-Runtime', '1')

    // Add necessary headers.
    // @TODO: Share the isomorphic logic with server/send-payload.ts.
    if (options.poweredByHeader && options.type === 'html') {
      res.setHeader('X-Powered-By', 'Next.js')
    }
    const resultContentType = options.result.contentType()

    if (!res.getHeader('Content-Type')) {
      res.setHeader(
        'Content-Type',
        resultContentType
          ? resultContentType
          : options.type === 'json'
          ? 'application/json'
          : 'text/html; charset=utf-8'
      )
    }

    if (options.result.isDynamic()) {
      const writer = res.transformStream.writable.getWriter()
      options.result.pipe({
        write: (chunk: Uint8Array) => writer.write(chunk),
        end: () => writer.close(),
        destroy: (err: Error) => writer.abort(err),
        cork: () => {},
        uncork: () => {},
        // Not implemented: on/removeListener
      } as any)
    } else {
      const payload = await options.result.toUnchunkedString()
      res.setHeader('Content-Length', String(byteLength(payload)))
      if (options.generateEtags) {
        res.setHeader('ETag', generateETag(payload))
      }
      res.body(payload)
    }

    res.send()
  }
  protected async runApi() {
    // @TODO
    return true
  }

  protected async findPageComponents({
    pathname,
    query,
    params,
  }: {
    pathname: string
    query: NextParsedUrlQuery
    params: Params | null
    isAppPath: boolean
  }) {
    const result = await this.serverOptions.webServerConfig.loadComponent(
      pathname
    )
    if (!result) return null

    return {
      query: {
        ...(query || {}),
        ...(params || {}),
      },
      components: result,
    }
  }
}
