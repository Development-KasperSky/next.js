import type { ClientPagesLoaderOptions } from './webpack/loaders/next-client-pages-loader'
import type { MiddlewareLoaderOptions } from './webpack/loaders/next-middleware-loader'
import type { MiddlewareSSRLoaderQuery } from './webpack/loaders/next-middleware-ssr-loader'
import type { NextConfigComplete, NextConfig } from '../server/config-shared'
import type { PageRuntime } from '../server/config-shared'
import type { ServerlessLoaderQuery } from './webpack/loaders/next-serverless-loader'
import type { webpack5 } from 'next/dist/compiled/webpack/webpack'
import type { LoadedEnvFiles } from '@next/env'
import fs from 'fs'
import chalk from 'next/dist/compiled/chalk'
import { posix, join } from 'path'
import { stringify } from 'querystring'
import {
  API_ROUTE,
  DOT_NEXT_ALIAS,
  PAGES_DIR_ALIAS,
  VIEWS_DIR_ALIAS,
} from '../lib/constants'
import {
  CLIENT_STATIC_FILES_RUNTIME_AMP,
  CLIENT_STATIC_FILES_RUNTIME_MAIN,
  CLIENT_STATIC_FILES_RUNTIME_MAIN_ROOT,
  CLIENT_STATIC_FILES_RUNTIME_REACT_REFRESH,
  EDGE_RUNTIME_WEBPACK,
} from '../shared/lib/constants'
import { MIDDLEWARE_ROUTE } from '../lib/constants'
import { __ApiPreviewProps } from '../server/api-utils'
import { isTargetLikeServerless } from '../server/utils'
import { warn } from './output/log'
import { parse } from '../build/swc'
import { isServerComponentPage, withoutRSCExtensions } from './utils'
import { normalizePathSep } from '../shared/lib/page-path/normalize-path-sep'
import { normalizePagePath } from '../shared/lib/page-path/normalize-page-path'
import { serverComponentRegex } from './webpack/loaders/utils'

type ObjectValue<T> = T extends { [key: string]: infer V } ? V : never

/**
 * For a given page path removes the provided extensions. `/_app.server` is a
 * special case because it is the only page where we want to preserve the RSC
 * server extension.
 */
export function getPageFromPath(pagePath: string, pageExtensions: string[]) {
  const extensions = pagePath.includes('/_app.server.')
    ? withoutRSCExtensions(pageExtensions)
    : pageExtensions

  let page = normalizePathSep(
    pagePath.replace(new RegExp(`\\.+(${extensions.join('|')})$`), '')
  )

  page = page.replace(/\/index$/, '')

  return page === '' ? '/' : page
}

export function createPagesMapping({
  hasServerComponents,
  isDev,
  isViews,
  pageExtensions,
  pagePaths,
}: {
  hasServerComponents: boolean
  isDev: boolean
  isViews?: boolean
  pageExtensions: string[]
  pagePaths: string[]
}): { [page: string]: string } {
  const previousPages: { [key: string]: string } = {}
  const pathAlias = isViews ? VIEWS_DIR_ALIAS : PAGES_DIR_ALIAS
  const pages = pagePaths.reduce<{ [key: string]: string }>(
    (result, pagePath) => {
      // Do not process .d.ts files inside the `pages` folder
      if (pagePath.endsWith('.d.ts') && pageExtensions.includes('ts')) {
        return result
      }

      const pageKey = getPageFromPath(pagePath, pageExtensions)

      // Assume that if there's a Client Component, that there is
      // a matching Server Component that will map to the page.
      // so we will not process it
      if (hasServerComponents && /\.client$/.test(pageKey)) {
        return result
      }

      if (pageKey in result) {
        warn(
          `Duplicate page detected. ${chalk.cyan(
            join('pages', previousPages[pageKey])
          )} and ${chalk.cyan(
            join('pages', pagePath)
          )} both resolve to ${chalk.cyan(pageKey)}.`
        )
      } else {
        previousPages[pageKey] = pagePath
      }

      result[pageKey] = normalizePathSep(join(pathAlias, pagePath))
      return result
    },
    {}
  )

  // In development we always alias these to allow Webpack to fallback to
  // the correct source file so that HMR can work properly when a file is
  // added or removed.

  if (isViews) {
    return pages
  }

  if (isDev) {
    delete pages['/_app']
    delete pages['/_app.server']
    delete pages['/_error']
    delete pages['/_document']
  }

  const root = isDev ? PAGES_DIR_ALIAS : 'next/dist/pages'
  return {
    '/_app': `${root}/_app`,
    '/_error': `${root}/_error`,
    '/_document': `${root}/_document`,
    ...(hasServerComponents ? { '/_app.server': `${root}/_app.server` } : {}),
    ...pages,
  }
}

type PageStaticInfo = { runtime?: PageRuntime; ssr?: boolean; ssg?: boolean }

const cachedPageStaticInfo = new Map<string, [number, PageStaticInfo]>()

// @TODO: We should limit the maximum concurrency of this function as there
// could be thousands of pages existing.
export async function getPageStaticInfo(
  pageFilePath: string,
  nextConfig: Partial<NextConfig>,
  isDev?: boolean
): Promise<PageStaticInfo> {
  const globalRuntime = nextConfig.experimental?.runtime
  const cached = cachedPageStaticInfo.get(pageFilePath)
  if (cached) {
    return cached[1]
  }

  let pageContent: string
  try {
    pageContent = await fs.promises.readFile(pageFilePath, {
      encoding: 'utf8',
    })
  } catch (err) {
    if (!isDev) throw err
    return {}
  }

  // When gSSP or gSP is used, this page requires an execution runtime. If the
  // page config is not present, we fallback to the global runtime. Related
  // discussion:
  // https://github.com/vercel/next.js/discussions/34179
  let isRuntimeRequired: boolean = false
  let pageRuntime: PageRuntime = undefined
  let ssr = false
  let ssg = false

  // Since these configurations should always be static analyzable, we can
  // skip these cases that "runtime" and "gSP", "gSSP" are not included in the
  // source code.
  if (/runtime|getStaticProps|getServerSideProps/.test(pageContent)) {
    try {
      const { body } = await parse(pageContent, {
        filename: pageFilePath,
        isModule: 'unknown',
      })

      for (const node of body) {
        const { type, declaration } = node
        if (type === 'ExportDeclaration') {
          // Match `export const config`
          const valueNode = declaration?.declarations?.[0]
          if (valueNode?.id?.value === 'config') {
            const props = valueNode.init.properties
            const runtimeKeyValue = props.find(
              (prop: any) => prop.key.value === 'runtime'
            )
            const runtime = runtimeKeyValue?.value?.value
            pageRuntime =
              runtime === 'edge' || runtime === 'nodejs' ? runtime : pageRuntime
          } else if (declaration?.type === 'FunctionDeclaration') {
            // Match `export function getStaticProps | getServerSideProps`
            const identifier = declaration.identifier?.value
            if (
              identifier === 'getStaticProps' ||
              identifier === 'getServerSideProps'
            ) {
              isRuntimeRequired = true
              ssg = identifier === 'getStaticProps'
              ssr = identifier === 'getServerSideProps'
            }
          }
        } else if (type === 'ExportNamedDeclaration') {
          // Match `export { getStaticProps | getServerSideProps } <from '../..'>`
          const { specifiers } = node
          for (const specifier of specifiers) {
            const { orig } = specifier
            const hasDataFetchingExports =
              specifier.type === 'ExportSpecifier' &&
              orig?.type === 'Identifier' &&
              (orig?.value === 'getStaticProps' ||
                orig?.value === 'getServerSideProps')
            if (hasDataFetchingExports) {
              isRuntimeRequired = true
              ssg = orig.value === 'getStaticProps'
              ssr = orig.value === 'getServerSideProps'
              break
            }
          }
        }
      }
    } catch (err) {}
  }

  if (!pageRuntime) {
    if (isRuntimeRequired) {
      pageRuntime = globalRuntime
    }
  } else {
    // For Node.js runtime, we do static optimization.
    if (!isRuntimeRequired && pageRuntime === 'nodejs') {
      pageRuntime = undefined
    }
  }

  const info = {
    runtime: pageRuntime,
    ssr,
    ssg,
  }
  cachedPageStaticInfo.set(pageFilePath, [Date.now(), info])
  return info
}

export function invalidatePageRuntimeCache(
  pageFilePath: string,
  safeTime: number
) {
  const cached = cachedPageStaticInfo.get(pageFilePath)
  if (cached && cached[0] < safeTime) {
    cachedPageStaticInfo.delete(pageFilePath)
  }
}

interface CreateEntrypointsParams {
  buildId: string
  config: NextConfigComplete
  envFiles: LoadedEnvFiles
  isDev?: boolean
  pages: { [page: string]: string }
  pagesDir: string
  previewMode: __ApiPreviewProps
  target: 'server' | 'serverless' | 'experimental-serverless-trace'
  viewsDir?: string
  viewPaths?: Record<string, string>
  pageExtensions: string[]
}

export function getEdgeServerEntry(opts: {
  absolutePagePath: string
  buildId: string
  bundlePath: string
  config: NextConfigComplete
  isDev: boolean
  isServerComponent: boolean
  page: string
  pages: { [page: string]: string }
}) {
  if (opts.page.match(MIDDLEWARE_ROUTE)) {
    const loaderParams: MiddlewareLoaderOptions = {
      absolutePagePath: opts.absolutePagePath,
      page: opts.page,
    }

    return `next-middleware-loader?${stringify(loaderParams)}!`
  }

  const loaderParams: MiddlewareSSRLoaderQuery = {
    absolute500Path: opts.pages['/500'] || '',
    absoluteAppPath: opts.pages['/_app'],
    absoluteAppServerPath: opts.pages['/_app.server'],
    absoluteDocumentPath: opts.pages['/_document'],
    absoluteErrorPath: opts.pages['/_error'],
    absolutePagePath: opts.absolutePagePath,
    buildId: opts.buildId,
    dev: opts.isDev,
    isServerComponent: isServerComponentPage(
      opts.config,
      opts.absolutePagePath
    ),
    page: opts.page,
    stringifiedConfig: JSON.stringify(opts.config),
  }

  return {
    import: `next-middleware-ssr-loader?${stringify(loaderParams)}!`,
    layer: opts.isServerComponent ? 'sc_server' : undefined,
  }
}

export function getViewsEntry(opts: {
  name: string
  pagePath: string
  viewsDir: string
  pageExtensions: string[]
}) {
  return `next-view-loader?${stringify(opts)}!`
}

export function getServerlessEntry(opts: {
  absolutePagePath: string
  buildId: string
  config: NextConfigComplete
  envFiles: LoadedEnvFiles
  page: string
  previewMode: __ApiPreviewProps
  pages: { [page: string]: string }
}): ObjectValue<webpack5.EntryObject> {
  const loaderParams: ServerlessLoaderQuery = {
    absolute404Path: opts.pages['/404'] || '',
    absoluteAppPath: opts.pages['/_app'],
    absoluteAppServerPath: opts.pages['/_app.server'],
    absoluteDocumentPath: opts.pages['/_document'],
    absoluteErrorPath: opts.pages['/_error'],
    absolutePagePath: opts.absolutePagePath,
    assetPrefix: opts.config.assetPrefix,
    basePath: opts.config.basePath,
    buildId: opts.buildId,
    canonicalBase: opts.config.amp.canonicalBase || '',
    distDir: DOT_NEXT_ALIAS,
    generateEtags: opts.config.generateEtags ? 'true' : '',
    i18n: opts.config.i18n ? JSON.stringify(opts.config.i18n) : '',
    // base64 encode to make sure contents don't break webpack URL loading
    loadedEnvFiles: Buffer.from(JSON.stringify(opts.envFiles)).toString(
      'base64'
    ),
    page: opts.page,
    poweredByHeader: opts.config.poweredByHeader ? 'true' : '',
    previewProps: JSON.stringify(opts.previewMode),
    reactRoot: !!opts.config.experimental.reactRoot ? 'true' : '',
    runtimeConfig:
      Object.keys(opts.config.publicRuntimeConfig).length > 0 ||
      Object.keys(opts.config.serverRuntimeConfig).length > 0
        ? JSON.stringify({
            publicRuntimeConfig: opts.config.publicRuntimeConfig,
            serverRuntimeConfig: opts.config.serverRuntimeConfig,
          })
        : '',
  }

  return `next-serverless-loader?${stringify(loaderParams)}!`
}

export function getClientEntry(opts: {
  absolutePagePath: string
  page: string
}) {
  const loaderOptions: ClientPagesLoaderOptions = {
    absolutePagePath: opts.absolutePagePath,
    page: opts.page,
  }

  const pageLoader = `next-client-pages-loader?${stringify(loaderOptions)}!`

  // Make sure next/router is a dependency of _app or else chunk splitting
  // might cause the router to not be able to load causing hydration
  // to fail
  return opts.page === '/_app'
    ? [pageLoader, require.resolve('../client/router')]
    : pageLoader
}

export async function createEntrypoints(params: CreateEntrypointsParams) {
  const {
    config,
    pages,
    pagesDir,
    isDev,
    target,
    viewsDir,
    viewPaths,
    pageExtensions,
  } = params
  const edgeServer: webpack5.EntryObject = {}
  const server: webpack5.EntryObject = {}
  const client: webpack5.EntryObject = {}

  const getEntryHandler =
    (mappings: Record<string, string>, isViews: boolean) =>
    async (page: string) => {
      const bundleFile = normalizePagePath(page)
      const clientBundlePath = posix.join('pages', bundleFile)
      const serverBundlePath = posix.join(
        isViews ? 'views' : 'pages',
        bundleFile
      )
      const absolutePagePath = mappings[page]

      // Handle paths that have aliases
      const pageFilePath = (() => {
        if (absolutePagePath.startsWith(PAGES_DIR_ALIAS)) {
          return absolutePagePath.replace(PAGES_DIR_ALIAS, pagesDir)
        }

        if (absolutePagePath.startsWith(VIEWS_DIR_ALIAS) && viewsDir) {
          return absolutePagePath.replace(VIEWS_DIR_ALIAS, viewsDir)
        }

        return require.resolve(absolutePagePath)
      })()

      const isServerComponent = serverComponentRegex.test(absolutePagePath)

      runDependingOnPageType({
        page,
        pageRuntime: (await getPageStaticInfo(pageFilePath, config, isDev))
          .runtime,
        onClient: () => {
          if (isServerComponent) {
            // We skip the initial entries for server component pages and let the
            // server compiler inject them instead.
          } else {
            client[clientBundlePath] = getClientEntry({
              absolutePagePath: mappings[page],
              page,
            })
          }
        },
        onServer: () => {
          if (isViews && viewsDir) {
            server[serverBundlePath] = getViewsEntry({
              name: serverBundlePath,
              pagePath: mappings[page],
              viewsDir,
              pageExtensions,
            })
          } else if (isTargetLikeServerless(target)) {
            if (page !== '/_app' && page !== '/_document') {
              server[serverBundlePath] = getServerlessEntry({
                ...params,
                absolutePagePath: mappings[page],
                page,
              })
            }
          } else {
            server[serverBundlePath] = isServerComponent
              ? {
                  import: mappings[page],
                  layer: 'sc_server',
                }
              : [mappings[page]]
          }
        },
        onEdgeServer: () => {
          edgeServer[serverBundlePath] = getEdgeServerEntry({
            ...params,
            absolutePagePath: mappings[page],
            bundlePath: clientBundlePath,
            isDev: false,
            isServerComponent,
            page,
          })
        },
      })
    }

  if (viewsDir && viewPaths) {
    const entryHandler = getEntryHandler(viewPaths, true)
    await Promise.all(Object.keys(viewPaths).map(entryHandler))
  }
  await Promise.all(Object.keys(pages).map(getEntryHandler(pages, false)))

  return {
    client,
    server,
    edgeServer,
  }
}

export function runDependingOnPageType<T>(params: {
  onClient: () => T
  onEdgeServer: () => T
  onServer: () => T
  page: string
  pageRuntime: PageRuntime
}) {
  if (params.page.match(MIDDLEWARE_ROUTE)) {
    return [params.onEdgeServer()]
  } else if (params.page.match(API_ROUTE)) {
    return [params.onServer()]
  } else if (params.page === '/_document') {
    return [params.onServer()]
  } else if (
    params.page === '/_app' ||
    params.page === '/_error' ||
    params.page === '/404' ||
    params.page === '/500'
  ) {
    return [params.onClient(), params.onServer()]
  } else {
    return [
      params.onClient(),
      params.pageRuntime === 'edge' ? params.onEdgeServer() : params.onServer(),
    ]
  }
}

export function finalizeEntrypoint({
  name,
  compilerType,
  value,
  isServerComponent,
}: {
  compilerType?: 'client' | 'server' | 'edge-server'
  name: string
  value: ObjectValue<webpack5.EntryObject>
  isServerComponent?: boolean
}): ObjectValue<webpack5.EntryObject> {
  const entry =
    typeof value !== 'object' || Array.isArray(value)
      ? { import: value }
      : value

  if (compilerType === 'server') {
    const isApi = name.startsWith('pages/api/')
    return {
      publicPath: isApi ? '' : undefined,
      runtime: isApi ? 'webpack-api-runtime' : 'webpack-runtime',
      layer: isApi ? 'api' : isServerComponent ? 'sc_server' : undefined,
      ...entry,
    }
  }

  if (compilerType === 'edge-server') {
    return {
      layer: MIDDLEWARE_ROUTE.test(name) ? 'middleware' : undefined,
      library: { name: ['_ENTRIES', `middleware_[name]`], type: 'assign' },
      runtime: EDGE_RUNTIME_WEBPACK,
      asyncChunks: false,
      ...entry,
    }
  }

  if (
    // Client special cases
    name !== 'polyfills' &&
    name !== CLIENT_STATIC_FILES_RUNTIME_MAIN &&
    name !== CLIENT_STATIC_FILES_RUNTIME_MAIN_ROOT &&
    name !== CLIENT_STATIC_FILES_RUNTIME_AMP &&
    name !== CLIENT_STATIC_FILES_RUNTIME_REACT_REFRESH
  ) {
    return {
      dependOn:
        name.startsWith('pages/') && name !== 'pages/_app'
          ? 'pages/_app'
          : 'main',
      ...entry,
    }
  }

  return entry
}
