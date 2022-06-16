import './node-polyfill-fetch'
import './node-polyfill-web-streams'

import type { Route } from './router'
import {
  CacheFs,
  DecodeError,
  execOnce,
  PageNotFoundError,
} from '../shared/lib/utils'
import type { MiddlewareManifest } from '../build/webpack/plugins/middleware-plugin'
import type RenderResult from './render-result'
import type { FetchEventResult } from './web/types'
import type { PrerenderManifest } from '../build'
import type { Rewrite } from '../lib/load-custom-routes'
import type { BaseNextRequest, BaseNextResponse } from './base-http'
import type { PagesManifest } from '../build/webpack/plugins/pages-manifest-plugin'
import type { PayloadOptions } from './send-payload'
import type { NextParsedUrlQuery, NextUrlWithParsedQuery } from './request-meta'
import type {
  Params,
  RouteMatch,
} from '../shared/lib/router/utils/route-matcher'

import fs from 'fs'
import { join, relative, resolve, sep } from 'path'
import { IncomingMessage, ServerResponse } from 'http'
import React from 'react'
import { addRequestMeta, getRequestMeta } from './request-meta'

import {
  PAGES_MANIFEST,
  BUILD_ID_FILE,
  MIDDLEWARE_MANIFEST,
  CLIENT_STATIC_FILES_PATH,
  CLIENT_STATIC_FILES_RUNTIME,
  PRERENDER_MANIFEST,
  ROUTES_MANIFEST,
  MIDDLEWARE_FLIGHT_MANIFEST,
  CLIENT_PUBLIC_FILES_PATH,
  APP_PATHS_MANIFEST,
} from '../shared/lib/constants'
import { recursiveReadDirSync } from './lib/recursive-readdir-sync'
import { format as formatUrl, UrlWithParsedQuery } from 'url'
import compression from 'next/dist/compiled/compression'
import HttpProxy from 'next/dist/compiled/http-proxy'
import { getPathMatch } from '../shared/lib/router/utils/path-match'
import { run } from './web/sandbox'

import { NodeNextRequest, NodeNextResponse } from './base-http/node'
import { sendRenderResult } from './send-payload'
import { getExtension, serveStatic } from './serve-static'
import { ParsedUrlQuery } from 'querystring'
import { apiResolver } from './api-utils/node'
import { RenderOpts, renderToHTML } from './render'
import { renderToHTML as appRenderToHTML } from './app-render'
import { ParsedUrl, parseUrl } from '../shared/lib/router/utils/parse-url'
import * as Log from '../build/output/log'

import BaseServer, {
  Options,
  FindComponentsResult,
  prepareServerlessUrl,
  stringifyQuery,
  RoutingItem,
} from './base-server'
import { getPagePath, requireFontManifest } from './require'
import { denormalizePagePath } from '../shared/lib/page-path/denormalize-page-path'
import { normalizePagePath } from '../shared/lib/page-path/normalize-page-path'
import { loadComponents } from './load-components'
import isError, { getProperError } from '../lib/is-error'
import { FontManifest } from './font-utils'
import { toNodeHeaders } from './web/utils'
import { relativizeURL } from '../shared/lib/router/utils/relativize-url'
import { prepareDestination } from '../shared/lib/router/utils/prepare-destination'
import { normalizeLocalePath } from '../shared/lib/i18n/normalize-locale-path'
import { getRouteMatcher } from '../shared/lib/router/utils/route-matcher'
import { loadEnvConfig } from '@next/env'
import { getCustomRoute } from './server-route-utils'
import { urlQueryToSearchParams } from '../shared/lib/router/utils/querystring'
import ResponseCache from '../server/response-cache'
import { removeTrailingSlash } from '../shared/lib/router/utils/remove-trailing-slash'
import { getNextPathnameInfo } from '../shared/lib/router/utils/get-next-pathname-info'
import { bodyStreamToNodeStream, clonableBodyForRequest } from './body-streams'
import { checkIsManualRevalidate } from './api-utils'

const shouldUseReactRoot = parseInt(React.version) >= 18
if (shouldUseReactRoot) {
  ;(process.env as any).__NEXT_REACT_ROOT = 'true'
}

export * from './base-server'

type ExpressMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: Error) => void
) => void

export interface NodeRequestHandler {
  (
    req: IncomingMessage | BaseNextRequest,
    res: ServerResponse | BaseNextResponse,
    parsedUrl?: NextUrlWithParsedQuery | undefined
  ): Promise<void>
}

const middlewareBetaWarning = execOnce(() => {
  Log.warn(
    `using beta Middleware (not covered by semver) - https://nextjs.org/docs/messages/beta-middleware`
  )
})

export default class NextNodeServer extends BaseServer {
  private imageResponseCache?: ResponseCache

  constructor(options: Options) {
    // Initialize super class
    super(options)

    /**
     * This sets environment variable to be used at the time of SSR by head.tsx.
     * Using this from process.env allows targeting both serverless and SSR by calling
     * `process.env.__NEXT_OPTIMIZE_CSS`.
     */
    if (this.renderOpts.optimizeFonts) {
      process.env.__NEXT_OPTIMIZE_FONTS = JSON.stringify(true)
    }
    if (this.renderOpts.optimizeCss) {
      process.env.__NEXT_OPTIMIZE_CSS = JSON.stringify(true)
    }
    if (this.renderOpts.nextScriptWorkers) {
      process.env.__NEXT_SCRIPT_WORKERS = JSON.stringify(true)
    }

    if (!this.minimalMode) {
      const { ImageOptimizerCache } =
        require('./image-optimizer') as typeof import('./image-optimizer')
      this.imageResponseCache = new ResponseCache(
        new ImageOptimizerCache({
          distDir: this.distDir,
          nextConfig: this.nextConfig,
        }),
        this.minimalMode
      )
    }

    if (!options.dev) {
      // pre-warm _document and _app as these will be
      // needed for most requests
      loadComponents(this.distDir, '/_document', this._isLikeServerless).catch(
        () => {}
      )
      loadComponents(this.distDir, '/_app', this._isLikeServerless).catch(
        () => {}
      )
    }
  }

  private compression =
    this.nextConfig.compress && this.nextConfig.target === 'server'
      ? (compression() as ExpressMiddleware)
      : undefined

  protected loadEnvConfig({ dev }: { dev: boolean }) {
    loadEnvConfig(this.dir, dev, Log)
  }

  protected getPublicDir(): string {
    return join(this.dir, CLIENT_PUBLIC_FILES_PATH)
  }

  protected getHasStaticDir(): boolean {
    return fs.existsSync(join(this.dir, 'static'))
  }

  protected getPagesManifest(): PagesManifest | undefined {
    return require(join(this.serverDistDir, PAGES_MANIFEST))
  }

  protected getAppPathsManifest(): PagesManifest | undefined {
    if (this.nextConfig.experimental.appDir) {
      const appPathsManifestPath = join(this.serverDistDir, APP_PATHS_MANIFEST)
      return require(appPathsManifestPath)
    }
  }

  protected getBuildId(): string {
    const buildIdFile = join(this.distDir, BUILD_ID_FILE)
    try {
      return fs.readFileSync(buildIdFile, 'utf8').trim()
    } catch (err) {
      if (!fs.existsSync(buildIdFile)) {
        throw new Error(
          `Could not find a production build in the '${this.distDir}' directory. Try building your app with 'next build' before starting the production server. https://nextjs.org/docs/messages/production-start-no-build-id`
        )
      }

      throw err
    }
  }

  protected generateImageRoutes(): Route[] {
    return [
      {
        match: getPathMatch('/_next/image'),
        type: 'route',
        name: '_next/image catchall',
        fn: async (req, res, _params, parsedUrl) => {
          if (this.minimalMode) {
            res.statusCode = 400
            res.body('Bad Request').send()
            return {
              finished: true,
            }
          }
          const { getHash, ImageOptimizerCache, sendResponse, ImageError } =
            require('./image-optimizer') as typeof import('./image-optimizer')

          if (!this.imageResponseCache) {
            throw new Error(
              'invariant image optimizer cache was not initialized'
            )
          }

          const imagesConfig = this.nextConfig.images

          if (imagesConfig.loader !== 'default') {
            await this.render404(req, res)
            return { finished: true }
          }
          const paramsResult = ImageOptimizerCache.validateParams(
            (req as NodeNextRequest).originalRequest,
            parsedUrl.query,
            this.nextConfig,
            !!this.renderOpts.dev
          )

          if ('errorMessage' in paramsResult) {
            res.statusCode = 400
            res.body(paramsResult.errorMessage).send()
            return { finished: true }
          }
          const cacheKey = ImageOptimizerCache.getCacheKey(paramsResult)

          try {
            const cacheEntry = await this.imageResponseCache.get(
              cacheKey,
              async () => {
                const { buffer, contentType, maxAge } =
                  await this.imageOptimizer(
                    req as NodeNextRequest,
                    res as NodeNextResponse,
                    paramsResult
                  )
                const etag = getHash([buffer])

                return {
                  value: {
                    kind: 'IMAGE',
                    buffer,
                    etag,
                    extension: getExtension(contentType) as string,
                  },
                  revalidate: maxAge,
                }
              },
              {}
            )

            if (cacheEntry?.value?.kind !== 'IMAGE') {
              throw new Error(
                'invariant did not get entry from image response cache'
              )
            }

            sendResponse(
              (req as NodeNextRequest).originalRequest,
              (res as NodeNextResponse).originalResponse,
              paramsResult.href,
              cacheEntry.value.extension,
              cacheEntry.value.buffer,
              paramsResult.isStatic,
              cacheEntry.isMiss ? 'MISS' : cacheEntry.isStale ? 'STALE' : 'HIT',
              imagesConfig.contentSecurityPolicy,
              cacheEntry.revalidate || 0,
              Boolean(this.renderOpts.dev)
            )
          } catch (err) {
            if (err instanceof ImageError) {
              res.statusCode = err.statusCode
              res.body(err.message).send()
              return {
                finished: true,
              }
            }
            throw err
          }
          return { finished: true }
        },
      },
    ]
  }

  protected generateStaticRoutes(): Route[] {
    return this.hasStaticDir
      ? [
          {
            // It's very important to keep this route's param optional.
            // (but it should support as many params as needed, separated by '/')
            // Otherwise this will lead to a pretty simple DOS attack.
            // See more: https://github.com/vercel/next.js/issues/2617
            match: getPathMatch('/static/:path*'),
            name: 'static catchall',
            fn: async (req, res, params, parsedUrl) => {
              const p = join(this.dir, 'static', ...params.path)
              await this.serveStatic(req, res, p, parsedUrl)
              return {
                finished: true,
              }
            },
          } as Route,
        ]
      : []
  }

  protected setImmutableAssetCacheControl(res: BaseNextResponse): void {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  }

  protected generateFsStaticRoutes(): Route[] {
    return [
      {
        match: getPathMatch('/_next/static/:path*'),
        type: 'route',
        name: '_next/static catchall',
        fn: async (req, res, params, parsedUrl) => {
          // make sure to 404 for /_next/static itself
          if (!params.path) {
            await this.render404(req, res, parsedUrl)
            return {
              finished: true,
            }
          }

          if (
            params.path[0] === CLIENT_STATIC_FILES_RUNTIME ||
            params.path[0] === 'chunks' ||
            params.path[0] === 'css' ||
            params.path[0] === 'image' ||
            params.path[0] === 'media' ||
            params.path[0] === this.buildId ||
            params.path[0] === 'pages' ||
            params.path[1] === 'pages'
          ) {
            this.setImmutableAssetCacheControl(res)
          }
          const p = join(
            this.distDir,
            CLIENT_STATIC_FILES_PATH,
            ...(params.path || [])
          )
          await this.serveStatic(req, res, p, parsedUrl)
          return {
            finished: true,
          }
        },
      },
    ]
  }

  protected generatePublicRoutes(): Route[] {
    if (!fs.existsSync(this.publicDir)) return []

    const publicFiles = new Set(
      recursiveReadDirSync(this.publicDir).map((p) =>
        encodeURI(p.replace(/\\/g, '/'))
      )
    )

    return [
      {
        match: getPathMatch('/:path*'),
        matchesBasePath: true,
        name: 'public folder catchall',
        fn: async (req, res, params, parsedUrl) => {
          const pathParts: string[] = params.path || []
          const { basePath } = this.nextConfig

          // if basePath is defined require it be present
          if (basePath) {
            const basePathParts = basePath.split('/')
            // remove first empty value
            basePathParts.shift()

            if (
              !basePathParts.every((part: string, idx: number) => {
                return part === pathParts[idx]
              })
            ) {
              return { finished: false }
            }

            pathParts.splice(0, basePathParts.length)
          }

          let path = `/${pathParts.join('/')}`

          if (!publicFiles.has(path)) {
            // In `next-dev-server.ts`, we ensure encoded paths match
            // decoded paths on the filesystem. So we need do the
            // opposite here: make sure decoded paths match encoded.
            path = encodeURI(path)
          }

          if (publicFiles.has(path)) {
            await this.serveStatic(
              req,
              res,
              join(this.publicDir, ...pathParts),
              parsedUrl
            )
            return {
              finished: true,
            }
          }
          return {
            finished: false,
          }
        },
      } as Route,
    ]
  }

  private _validFilesystemPathSet: Set<string> | null = null
  protected getFilesystemPaths(): Set<string> {
    if (this._validFilesystemPathSet) {
      return this._validFilesystemPathSet
    }

    const pathUserFilesStatic = join(this.dir, 'static')
    let userFilesStatic: string[] = []
    if (this.hasStaticDir && fs.existsSync(pathUserFilesStatic)) {
      userFilesStatic = recursiveReadDirSync(pathUserFilesStatic).map((f) =>
        join('.', 'static', f)
      )
    }

    let userFilesPublic: string[] = []
    if (this.publicDir && fs.existsSync(this.publicDir)) {
      userFilesPublic = recursiveReadDirSync(this.publicDir).map((f) =>
        join('.', 'public', f)
      )
    }

    let nextFilesStatic: string[] = []

    nextFilesStatic =
      !this.minimalMode && fs.existsSync(join(this.distDir, 'static'))
        ? recursiveReadDirSync(join(this.distDir, 'static')).map((f) =>
            join('.', relative(this.dir, this.distDir), 'static', f)
          )
        : []

    return (this._validFilesystemPathSet = new Set<string>([
      ...nextFilesStatic,
      ...userFilesPublic,
      ...userFilesStatic,
    ]))
  }

  protected sendRenderResult(
    req: NodeNextRequest,
    res: NodeNextResponse,
    options: {
      result: RenderResult
      type: 'html' | 'json'
      generateEtags: boolean
      poweredByHeader: boolean
      options?: PayloadOptions | undefined
    }
  ): Promise<void> {
    return sendRenderResult({
      req: req.originalRequest,
      res: res.originalResponse,
      ...options,
    })
  }

  protected sendStatic(
    req: NodeNextRequest,
    res: NodeNextResponse,
    path: string
  ): Promise<void> {
    return serveStatic(req.originalRequest, res.originalResponse, path)
  }

  protected handleCompression(
    req: NodeNextRequest,
    res: NodeNextResponse
  ): void {
    if (this.compression) {
      this.compression(req.originalRequest, res.originalResponse, () => {})
    }
  }

  protected async proxyRequest(
    req: NodeNextRequest,
    res: NodeNextResponse,
    parsedUrl: ParsedUrl
  ) {
    const { query } = parsedUrl
    delete (parsedUrl as any).query
    parsedUrl.search = stringifyQuery(req, query)

    const target = formatUrl(parsedUrl)
    const proxy = new HttpProxy({
      target,
      changeOrigin: true,
      ignorePath: true,
      xfwd: true,
      proxyTimeout: 30_000, // limit proxying to 30 seconds
    })

    await new Promise((proxyResolve, proxyReject) => {
      let finished = false

      proxy.on('proxyReq', (proxyReq) => {
        proxyReq.on('close', () => {
          if (!finished) {
            finished = true
            proxyResolve(true)
          }
        })
      })
      proxy.on('error', (err) => {
        if (!finished) {
          finished = true
          proxyReject(err)
        }
      })
      proxy.web(req.originalRequest, res.originalResponse)
    })

    return {
      finished: true,
    }
  }

  protected async runApi(
    req: NodeNextRequest,
    res: NodeNextResponse,
    query: ParsedUrlQuery,
    params: Params | false,
    page: string,
    builtPagePath: string
  ): Promise<boolean> {
    const handledAsEdgeFunction = await this.runEdgeFunctionApiEndpoint({
      req,
      res,
      query,
      params,
      page,
      builtPagePath,
    })

    if (handledAsEdgeFunction) {
      return true
    }

    const pageModule = await require(builtPagePath)
    query = { ...query, ...params }

    delete query.__nextLocale
    delete query.__nextDefaultLocale

    if (!this.renderOpts.dev && this._isLikeServerless) {
      if (typeof pageModule.default === 'function') {
        prepareServerlessUrl(req, query)
        await pageModule.default(req, res)
        return true
      }
    }

    await apiResolver(
      req.originalRequest,
      res.originalResponse,
      query,
      pageModule,
      {
        ...this.renderOpts.previewProps,
        revalidate: (newReq: IncomingMessage, newRes: ServerResponse) =>
          this.getRequestHandler()(
            new NodeNextRequest(newReq),
            new NodeNextResponse(newRes)
          ),
        // internal config so is not typed
        trustHostHeader: (this.nextConfig.experimental as any).trustHostHeader,
      },
      this.minimalMode,
      this.renderOpts.dev,
      page
    )
    return true
  }

  protected async renderHTML(
    req: NodeNextRequest,
    res: NodeNextResponse,
    pathname: string,
    query: NextParsedUrlQuery,
    renderOpts: RenderOpts
  ): Promise<RenderResult | null> {
    // Due to the way we pass data by mutating `renderOpts`, we can't extend the
    // object here but only updating its `serverComponentManifest` field.
    // https://github.com/vercel/next.js/blob/df7cbd904c3bd85f399d1ce90680c0ecf92d2752/packages/next/server/render.tsx#L947-L952
    renderOpts.serverComponentManifest = this.serverComponentManifest

    if (renderOpts.isAppPath) {
      return appRenderToHTML(
        req.originalRequest,
        res.originalResponse,
        pathname,
        query,
        renderOpts
      )
    }

    return renderToHTML(
      req.originalRequest,
      res.originalResponse,
      pathname,
      query,
      renderOpts
    )
  }

  protected streamResponseChunk(res: NodeNextResponse, chunk: any) {
    res.originalResponse.write(chunk)

    // When both compression and streaming are enabled, we need to explicitly
    // flush the response to avoid it being buffered by gzip.
    if (this.compression && 'flush' in res.originalResponse) {
      ;(res.originalResponse as any).flush()
    }
  }

  protected async imageOptimizer(
    req: NodeNextRequest,
    res: NodeNextResponse,
    paramsResult: import('./image-optimizer').ImageParamsResult
  ): Promise<{ buffer: Buffer; contentType: string; maxAge: number }> {
    const { imageOptimizer } =
      require('./image-optimizer') as typeof import('./image-optimizer')

    return imageOptimizer(
      req.originalRequest,
      res.originalResponse,
      paramsResult,
      this.nextConfig,
      (newReq, newRes, newParsedUrl) =>
        this.getRequestHandler()(
          new NodeNextRequest(newReq),
          new NodeNextResponse(newRes),
          newParsedUrl
        )
    )
  }

  protected getPagePath(pathname: string, locales?: string[]): string {
    return getPagePath(
      pathname,
      this.distDir,
      this._isLikeServerless,
      this.renderOpts.dev,
      locales,
      this.nextConfig.experimental.appDir
    )
  }

  protected async findPageComponents(
    pathname: string,
    query: NextParsedUrlQuery = {},
    params: Params | null = null
  ): Promise<FindComponentsResult | null> {
    let paths = [
      // try serving a static AMP version first
      query.amp ? normalizePagePath(pathname) + '.amp' : null,
      pathname,
    ].filter(Boolean)

    if (query.__nextLocale) {
      paths = [
        ...paths.map(
          (path) => `/${query.__nextLocale}${path === '/' ? '' : path}`
        ),
        ...paths,
      ]
    }

    for (const pagePath of paths) {
      try {
        const components = await loadComponents(
          this.distDir,
          pagePath!,
          !this.renderOpts.dev && this._isLikeServerless,
          this.renderOpts.serverComponents,
          this.nextConfig.experimental.appDir
        )

        if (
          query.__nextLocale &&
          typeof components.Component === 'string' &&
          !pagePath?.startsWith(`/${query.__nextLocale}`)
        ) {
          // if loading an static HTML file the locale is required
          // to be present since all HTML files are output under their locale
          continue
        }

        return {
          components,
          query: {
            ...(components.getStaticProps
              ? ({
                  amp: query.amp,
                  __nextDataReq: query.__nextDataReq,
                  __nextLocale: query.__nextLocale,
                  __nextDefaultLocale: query.__nextDefaultLocale,
                  __flight__: query.__flight__,
                } as NextParsedUrlQuery)
              : query),
            ...(params || {}),
          },
        }
      } catch (err) {
        // we should only not throw if we failed to find the page
        // in the pages-manifest
        if (!(err instanceof PageNotFoundError)) {
          throw err
        }
      }
    }
    return null
  }

  protected getFontManifest(): FontManifest {
    return requireFontManifest(this.distDir, this._isLikeServerless)
  }

  protected getServerComponentManifest() {
    if (!this.nextConfig.experimental.serverComponents) return undefined
    return require(join(
      this.distDir,
      'server',
      MIDDLEWARE_FLIGHT_MANIFEST + '.json'
    ))
  }

  protected getCacheFilesystem(): CacheFs {
    return {
      readFile: (f) => fs.promises.readFile(f, 'utf8'),
      readFileSync: (f) => fs.readFileSync(f, 'utf8'),
      writeFile: (f, d) => fs.promises.writeFile(f, d, 'utf8'),
      mkdir: (dir) => fs.promises.mkdir(dir, { recursive: true }),
      stat: (f) => fs.promises.stat(f),
    }
  }

  private normalizeReq(
    req: BaseNextRequest | IncomingMessage
  ): BaseNextRequest {
    return req instanceof IncomingMessage ? new NodeNextRequest(req) : req
  }

  private normalizeRes(
    res: BaseNextResponse | ServerResponse
  ): BaseNextResponse {
    return res instanceof ServerResponse ? new NodeNextResponse(res) : res
  }

  public getRequestHandler(): NodeRequestHandler {
    const handler = super.getRequestHandler()
    return async (req, res, parsedUrl) => {
      return handler(this.normalizeReq(req), this.normalizeRes(res), parsedUrl)
    }
  }

  public async render(
    req: BaseNextRequest | IncomingMessage,
    res: BaseNextResponse | ServerResponse,
    pathname: string,
    query?: NextParsedUrlQuery,
    parsedUrl?: NextUrlWithParsedQuery,
    internal = false
  ): Promise<void> {
    return super.render(
      this.normalizeReq(req),
      this.normalizeRes(res),
      pathname,
      query,
      parsedUrl,
      internal
    )
  }

  public async renderToHTML(
    req: BaseNextRequest | IncomingMessage,
    res: BaseNextResponse | ServerResponse,
    pathname: string,
    query?: ParsedUrlQuery
  ): Promise<string | null> {
    return super.renderToHTML(
      this.normalizeReq(req),
      this.normalizeRes(res),
      pathname,
      query
    )
  }

  public async renderError(
    err: Error | null,
    req: BaseNextRequest | IncomingMessage,
    res: BaseNextResponse | ServerResponse,
    pathname: string,
    query?: NextParsedUrlQuery,
    setHeaders?: boolean
  ): Promise<void> {
    return super.renderError(
      err,
      this.normalizeReq(req),
      this.normalizeRes(res),
      pathname,
      query,
      setHeaders
    )
  }

  public async renderErrorToHTML(
    err: Error | null,
    req: BaseNextRequest | IncomingMessage,
    res: BaseNextResponse | ServerResponse,
    pathname: string,
    query?: ParsedUrlQuery
  ): Promise<string | null> {
    return super.renderErrorToHTML(
      err,
      this.normalizeReq(req),
      this.normalizeRes(res),
      pathname,
      query
    )
  }

  public async render404(
    req: BaseNextRequest | IncomingMessage,
    res: BaseNextResponse | ServerResponse,
    parsedUrl?: NextUrlWithParsedQuery,
    setHeaders?: boolean
  ): Promise<void> {
    return super.render404(
      this.normalizeReq(req),
      this.normalizeRes(res),
      parsedUrl,
      setHeaders
    )
  }

  public async serveStatic(
    req: BaseNextRequest | IncomingMessage,
    res: BaseNextResponse | ServerResponse,
    path: string,
    parsedUrl?: UrlWithParsedQuery
  ): Promise<void> {
    if (!this.isServeableUrl(path)) {
      return this.render404(req, res, parsedUrl)
    }

    if (!(req.method === 'GET' || req.method === 'HEAD')) {
      res.statusCode = 405
      res.setHeader('Allow', ['GET', 'HEAD'])
      return this.renderError(null, req, res, path)
    }

    try {
      await this.sendStatic(
        req as NodeNextRequest,
        res as NodeNextResponse,
        path
      )
    } catch (error) {
      if (!isError(error)) throw error
      const err = error as Error & { code?: string; statusCode?: number }
      if (err.code === 'ENOENT' || err.statusCode === 404) {
        this.render404(req, res, parsedUrl)
      } else if (err.statusCode === 412) {
        res.statusCode = 412
        return this.renderError(err, req, res, path)
      } else {
        throw err
      }
    }
  }

  protected getStaticRoutes(): Route[] {
    return this.hasStaticDir
      ? [
          {
            // It's very important to keep this route's param optional.
            // (but it should support as many params as needed, separated by '/')
            // Otherwise this will lead to a pretty simple DOS attack.
            // See more: https://github.com/vercel/next.js/issues/2617
            match: getPathMatch('/static/:path*'),
            name: 'static catchall',
            fn: async (req, res, params, parsedUrl) => {
              const p = join(this.dir, 'static', ...params.path)
              await this.serveStatic(req, res, p, parsedUrl)
              return {
                finished: true,
              }
            },
          } as Route,
        ]
      : []
  }

  protected isServeableUrl(untrustedFileUrl: string): boolean {
    // This method mimics what the version of `send` we use does:
    // 1. decodeURIComponent:
    //    https://github.com/pillarjs/send/blob/0.17.1/index.js#L989
    //    https://github.com/pillarjs/send/blob/0.17.1/index.js#L518-L522
    // 2. resolve:
    //    https://github.com/pillarjs/send/blob/de073ed3237ade9ff71c61673a34474b30e5d45b/index.js#L561

    let decodedUntrustedFilePath: string
    try {
      // (1) Decode the URL so we have the proper file name
      decodedUntrustedFilePath = decodeURIComponent(untrustedFileUrl)
    } catch {
      return false
    }

    // (2) Resolve "up paths" to determine real request
    const untrustedFilePath = resolve(decodedUntrustedFilePath)

    // don't allow null bytes anywhere in the file path
    if (untrustedFilePath.indexOf('\0') !== -1) {
      return false
    }

    // Check if .next/static, static and public are in the path.
    // If not the path is not available.
    if (
      (untrustedFilePath.startsWith(join(this.distDir, 'static') + sep) ||
        untrustedFilePath.startsWith(join(this.dir, 'static') + sep) ||
        untrustedFilePath.startsWith(join(this.dir, 'public') + sep)) === false
    ) {
      return false
    }

    // Check against the real filesystem paths
    const filesystemUrls = this.getFilesystemPaths()
    const resolved = relative(this.dir, untrustedFilePath)
    return filesystemUrls.has(resolved)
  }

  protected generateRewrites({
    restrictedRedirectPaths,
  }: {
    restrictedRedirectPaths: string[]
  }) {
    let beforeFiles: Route[] = []
    let afterFiles: Route[] = []
    let fallback: Route[] = []

    if (!this.minimalMode) {
      const buildRewrite = (rewrite: Rewrite, check = true): Route => {
        const rewriteRoute = getCustomRoute({
          type: 'rewrite',
          rule: rewrite,
          restrictedRedirectPaths,
        })
        return {
          ...rewriteRoute,
          check,
          type: rewriteRoute.type,
          name: `Rewrite route ${rewriteRoute.source}`,
          match: rewriteRoute.match,
          matchesBasePath: true,
          matchesLocale: true,
          matchesLocaleAPIRoutes: true,
          matchesTrailingSlash: true,
          fn: async (req, res, params, parsedUrl) => {
            const { newUrl, parsedDestination } = prepareDestination({
              appendParamsToQuery: true,
              destination: rewriteRoute.destination,
              params: params,
              query: parsedUrl.query,
            })

            // external rewrite, proxy it
            if (parsedDestination.protocol) {
              return this.proxyRequest(
                req as NodeNextRequest,
                res as NodeNextResponse,
                parsedDestination
              )
            }

            addRequestMeta(req, '_nextRewroteUrl', newUrl)
            addRequestMeta(req, '_nextDidRewrite', newUrl !== req.url)

            return {
              finished: false,
              pathname: newUrl,
              query: parsedDestination.query,
            }
          },
        }
      }

      if (Array.isArray(this.customRoutes.rewrites)) {
        afterFiles = this.customRoutes.rewrites.map((r) => buildRewrite(r))
      } else {
        beforeFiles = this.customRoutes.rewrites.beforeFiles.map((r) =>
          buildRewrite(r, false)
        )
        afterFiles = this.customRoutes.rewrites.afterFiles.map((r) =>
          buildRewrite(r)
        )
        fallback = this.customRoutes.rewrites.fallback.map((r) =>
          buildRewrite(r)
        )
      }
    }

    return {
      beforeFiles,
      afterFiles,
      fallback,
    }
  }

  /**
   * Return a list of middleware routing items. This method exists to be later
   * overridden by the development server in order to use a different source
   * to get the list.
   */
  protected getMiddleware(): RoutingItem[] {
    if (this.minimalMode) {
      return []
    }

    const manifest: MiddlewareManifest = require(join(
      this.serverDistDir,
      MIDDLEWARE_MANIFEST
    ))

    return manifest.sortedMiddleware.map((page) => ({
      match: getMiddlewareMatcher(manifest.middleware[page]),
      page,
    }))
  }

  /**
   * Get information for the edge function located in the provided page
   * folder. If the edge function info can't be found it will throw
   * an error.
   */
  protected getEdgeFunctionInfo(params: {
    page: string
    /** Whether we should look for a middleware or not */
    middleware: boolean
  }) {
    const manifest: MiddlewareManifest = require(join(
      this.serverDistDir,
      MIDDLEWARE_MANIFEST
    ))

    let foundPage: string

    try {
      foundPage = denormalizePagePath(normalizePagePath(params.page))
    } catch (err) {
      throw new PageNotFoundError(params.page)
    }

    let pageInfo = params.middleware
      ? manifest.middleware[foundPage]
      : manifest.functions[foundPage]
    if (!pageInfo) {
      throw new PageNotFoundError(foundPage)
    }

    return {
      name: pageInfo.name,
      paths: pageInfo.files.map((file) => join(this.distDir, file)),
      env: pageInfo.env ?? [],
      wasm: (pageInfo.wasm ?? []).map((binding) => ({
        ...binding,
        filePath: join(this.distDir, binding.filePath),
      })),
    }
  }

  /**
   * Checks if a middleware exists. This method is useful for the development
   * server where we need to check the filesystem. Here we just check the
   * middleware manifest.
   */
  protected async hasMiddleware(
    pathname: string,
    _isSSR?: boolean
  ): Promise<boolean> {
    try {
      return (
        this.getEdgeFunctionInfo({ page: pathname, middleware: true }).paths
          .length > 0
      )
    } catch (_) {}

    return false
  }

  /**
   * A placeholder for a function to be defined in the development server.
   * It will make sure that the middleware has been compiled so that we
   * can run it.
   */
  protected async ensureMiddleware(_pathname: string, _isSSR?: boolean) {}

  /**
   * This method gets all middleware matchers and execute them when the request
   * matches. It will make sure that each middleware exists and is compiled and
   * ready to be invoked. The development server will decorate it to add warns
   * and errors with rich traces.
   */
  protected async runMiddleware(params: {
    request: BaseNextRequest
    response: BaseNextResponse
    parsedUrl: ParsedUrl
    parsed: UrlWithParsedQuery
    onWarning?: (warning: Error) => void
  }) {
    middlewareBetaWarning()

    // middleware is skipped for on-demand revalidate requests
    if (
      checkIsManualRevalidate(params.request, this.renderOpts.previewProps)
        .isManualRevalidate
    ) {
      return { finished: false }
    }
    const normalizedPathname = removeTrailingSlash(params.parsed.pathname || '')

    // For middleware to "fetch" we must always provide an absolute URL
    const query = urlQueryToSearchParams(params.parsed.query).toString()
    const locale = params.parsed.query.__nextLocale
    const url = `http://${this.hostname}:${this.port}${
      locale ? `/${locale}` : ''
    }${params.parsed.pathname}${query ? `?${query}` : ''}`

    if (!url.startsWith('http')) {
      throw new Error(
        'To use middleware you must provide a `hostname` and `port` to the Next.js Server'
      )
    }

    const page: { name?: string; params?: { [key: string]: string } } = {}
    if (await this.hasPage(normalizedPathname)) {
      page.name = params.parsedUrl.pathname
    } else if (this.dynamicRoutes) {
      for (const dynamicRoute of this.dynamicRoutes) {
        const matchParams = dynamicRoute.match(normalizedPathname)
        if (matchParams) {
          page.name = dynamicRoute.page
          page.params = matchParams
          break
        }
      }
    }

    const allHeaders = new Headers()
    let result: FetchEventResult | null = null
    const method = (params.request.method || 'GET').toUpperCase()
    let originalBody =
      method !== 'GET' && method !== 'HEAD'
        ? clonableBodyForRequest(params.request.body)
        : undefined

    for (const middleware of this.getMiddleware()) {
      if (middleware.match(normalizedPathname)) {
        if (!(await this.hasMiddleware(middleware.page, middleware.ssr))) {
          console.warn(`The Edge Function for ${middleware.page} was not found`)
          continue
        }

        await this.ensureMiddleware(middleware.page, middleware.ssr)
        const middlewareInfo = this.getEdgeFunctionInfo({
          page: middleware.page,
          middleware: true,
        })

        result = await run({
          name: middlewareInfo.name,
          paths: middlewareInfo.paths,
          env: middlewareInfo.env,
          wasm: middlewareInfo.wasm,
          request: {
            headers: params.request.headers,
            method,
            nextConfig: {
              basePath: this.nextConfig.basePath,
              i18n: this.nextConfig.i18n,
              trailingSlash: this.nextConfig.trailingSlash,
            },
            url: url,
            page: page,
            body: originalBody?.cloneBodyStream(),
          },
          useCache: !this.nextConfig.experimental.runtime,
          onWarning: (warning: Error) => {
            if (params.onWarning) {
              warning.message += ` "./${middlewareInfo.name}"`
              params.onWarning(warning)
            }
          },
        })

        for (let [key, value] of result.response.headers) {
          if (key !== 'x-middleware-next') {
            allHeaders.append(key, value)
          }
        }

        if (!this.renderOpts.dev) {
          result.waitUntil.catch((error) => {
            console.error(`Uncaught: middleware waitUntil errored`, error)
          })
        }

        if (!result.response.headers.has('x-middleware-next')) {
          break
        }
      }
    }

    if (!result) {
      this.render404(params.request, params.response, params.parsed)
      return { finished: true }
    } else {
      for (let [key, value] of allHeaders) {
        result.response.headers.set(key, value)
      }
    }

    await originalBody?.finalize()
    return result
  }

  protected generateCatchAllMiddlewareRoute(
    devReady?: boolean
  ): Route | undefined {
    if (this.minimalMode) return undefined

    if ((!this.renderOpts.dev || devReady) && !this.getMiddleware().length) {
      return undefined
    }

    return {
      match: getPathMatch('/:path*'),
      matchesBasePath: true,
      matchesLocale: true,
      type: 'route',
      name: 'middleware catchall',
      fn: async (req, res, _params, parsed) => {
        const middleware = this.getMiddleware()
        if (!middleware.length) {
          return { finished: false }
        }

        const initUrl = getRequestMeta(req, '__NEXT_INIT_URL')!
        const parsedUrl = parseUrl(initUrl)
        const pathnameInfo = getNextPathnameInfo(parsedUrl.pathname, {
          nextConfig: this.nextConfig,
        })

        parsedUrl.pathname = pathnameInfo.pathname
        const normalizedPathname = removeTrailingSlash(parsed.pathname || '')
        if (!middleware.some((m) => m.match(normalizedPathname))) {
          return { finished: false }
        }

        let result: Awaited<ReturnType<typeof this.runMiddleware>>

        try {
          result = await this.runMiddleware({
            request: req,
            response: res,
            parsedUrl: parsedUrl,
            parsed: parsed,
          })
        } catch (err) {
          if (isError(err) && err.code === 'ENOENT') {
            await this.render404(req, res, parsed)
            return { finished: true }
          }

          if (err instanceof DecodeError) {
            res.statusCode = 400
            this.renderError(err, req, res, parsed.pathname || '')
            return { finished: true }
          }

          const error = getProperError(err)
          console.error(error)
          res.statusCode = 500
          this.renderError(error, req, res, parsed.pathname || '')
          return { finished: true }
        }

        if ('finished' in result) {
          return result
        }

        if (result.response.headers.has('x-middleware-rewrite')) {
          const value = result.response.headers.get('x-middleware-rewrite')!
          const rel = relativizeURL(value, initUrl)
          result.response.headers.set('x-middleware-rewrite', rel)
        }

        if (result.response.headers.has('Location')) {
          const value = result.response.headers.get('Location')!
          const rel = relativizeURL(value, initUrl)
          result.response.headers.set('Location', rel)
        }

        if (
          !result.response.headers.has('x-middleware-rewrite') &&
          !result.response.headers.has('x-middleware-next') &&
          !result.response.headers.has('Location')
        ) {
          result.response.headers.set('x-middleware-refresh', '1')
        }

        result.response.headers.delete('x-middleware-next')

        for (const [key, value] of Object.entries(
          toNodeHeaders(result.response.headers)
        )) {
          if (
            [
              'x-middleware-rewrite',
              'x-middleware-redirect',
              'x-middleware-refresh',
            ].includes(key)
          ) {
            continue
          }
          if (key !== 'content-encoding' && value !== undefined) {
            res.setHeader(key, value)
          }
        }

        res.statusCode = result.response.status
        res.statusMessage = result.response.statusText

        const location = result.response.headers.get('Location')
        if (location) {
          res.statusCode = result.response.status
          if (res.statusCode === 308) {
            res.setHeader('Refresh', `0;url=${location}`)
          }

          res.body(location).send()
          return {
            finished: true,
          }
        }

        if (result.response.headers.has('x-middleware-rewrite')) {
          const rewritePath = result.response.headers.get(
            'x-middleware-rewrite'
          )!
          const parsedDestination = parseUrl(rewritePath)
          const newUrl = parsedDestination.pathname

          if (
            parsedDestination.protocol &&
            (parsedDestination.port
              ? `${parsedDestination.hostname}:${parsedDestination.port}`
              : parsedDestination.hostname) !== req.headers.host
          ) {
            return this.proxyRequest(
              req as NodeNextRequest,
              res as NodeNextResponse,
              parsedDestination
            )
          }

          if (this.nextConfig.i18n) {
            const localePathResult = normalizeLocalePath(
              newUrl,
              this.nextConfig.i18n.locales
            )
            if (localePathResult.detectedLocale) {
              parsedDestination.query.__nextLocale =
                localePathResult.detectedLocale
            }
          }

          addRequestMeta(req, '_nextRewroteUrl', newUrl)
          addRequestMeta(req, '_nextDidRewrite', newUrl !== req.url)

          return {
            finished: false,
            pathname: newUrl,
            query: parsedDestination.query,
          }
        }

        if (result.response.headers.has('x-middleware-refresh')) {
          res.statusCode = result.response.status
          for await (const chunk of result.response.body || ([] as any)) {
            this.streamResponseChunk(res as NodeNextResponse, chunk)
          }
          res.send()
          return {
            finished: true,
          }
        }

        return {
          finished: false,
        }
      },
    }
  }

  private _cachedPreviewManifest: PrerenderManifest | undefined
  protected getPrerenderManifest(): PrerenderManifest {
    if (this._cachedPreviewManifest) {
      return this._cachedPreviewManifest
    }
    const manifest = require(join(this.distDir, PRERENDER_MANIFEST))
    return (this._cachedPreviewManifest = manifest)
  }

  protected getRoutesManifest() {
    return require(join(this.distDir, ROUTES_MANIFEST))
  }

  private async runEdgeFunctionApiEndpoint(params: {
    req: NodeNextRequest
    res: NodeNextResponse
    query: ParsedUrlQuery
    params: Params | false
    page: string
    builtPagePath: string
  }): Promise<boolean> {
    let middlewareInfo: ReturnType<typeof this.getEdgeFunctionInfo> | undefined

    try {
      middlewareInfo = this.getEdgeFunctionInfo({
        page: params.page,
        middleware: false,
      })
    } catch {
      return false
    }

    // For middleware to "fetch" we must always provide an absolute URL
    const url = getRequestMeta(params.req, '__NEXT_INIT_URL')!
    if (!url.startsWith('http')) {
      throw new Error(
        'To use middleware you must provide a `hostname` and `port` to the Next.js Server'
      )
    }

    const result = await run({
      name: middlewareInfo.name,
      paths: middlewareInfo.paths,
      env: middlewareInfo.env,
      wasm: middlewareInfo.wasm,
      request: {
        headers: params.req.headers,
        method: params.req.method,
        nextConfig: {
          basePath: this.nextConfig.basePath,
          i18n: this.nextConfig.i18n,
          trailingSlash: this.nextConfig.trailingSlash,
        },
        url,
        page: {
          name: params.page,
          ...(params.params && { params: params.params }),
        },
        // TODO(gal): complete body
        // body: originalBody?.cloneBodyStream(),
      },
      useCache: !this.nextConfig.experimental.runtime,
      onWarning: (_warning: Error) => {
        // if (params.onWarning) {
        //   warning.message += ` "./${middlewareInfo.name}"`
        //   params.onWarning(warning)
        // }
      },
    })

    params.res.statusCode = result.response.status
    params.res.statusMessage = result.response.statusText

    result.response.headers.forEach((value, key) => {
      params.res.appendHeader(key, value)
    })

    if (result.response.body) {
      // TODO(gal): not sure that we always need to stream
      bodyStreamToNodeStream(result.response.body).pipe(
        params.res.originalResponse
      )
    } else {
      params.res.originalResponse.end()
    }

    return true
  }
}

const MiddlewareMatcherCache = new WeakMap<
  MiddlewareManifest['middleware'][string],
  RouteMatch
>()

function getMiddlewareMatcher(
  info: MiddlewareManifest['middleware'][string]
): RouteMatch {
  const stored = MiddlewareMatcherCache.get(info)
  if (stored) {
    return stored
  }

  if (typeof info.regexp !== 'string' || !info.regexp) {
    throw new Error(
      `Invariant: invalid regexp for middleware ${JSON.stringify(info)}`
    )
  }

  const matcher = getRouteMatcher({ re: new RegExp(info.regexp), groups: {} })
  MiddlewareMatcherCache.set(info, matcher)
  return matcher
}
