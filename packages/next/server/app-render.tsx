import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'http'
import type { LoadComponentsReturnType } from './load-components'
import type { ServerRuntime } from '../types'

import React from 'react'
import { ParsedUrlQuery, stringify as stringifyQuery } from 'querystring'
import { createFromReadableStream } from 'next/dist/compiled/react-server-dom-webpack'
import { renderToReadableStream } from 'next/dist/compiled/react-server-dom-webpack/writer.browser.server'
import { NextParsedUrlQuery } from './request-meta'
import RenderResult from './render-result'
import {
  readableStreamTee,
  encodeText,
  decodeText,
  renderToInitialStream,
  createBufferedTransformStream,
  continueFromInitialStream,
} from './node-web-streams-helper'
import { isDynamicRoute } from '../shared/lib/router/utils'
import { ESCAPE_REGEX, htmlEscapeJsonString } from './htmlescape'
import { shouldUseReactRoot } from './utils'
import { NextApiRequestCookies } from './api-utils'
import { matchSegment } from '../client/components/match-segments'
import {
  FlightCSSManifest,
  FlightManifest,
} from '../build/webpack/plugins/flight-manifest-plugin'
import { FlushEffectsContext } from '../shared/lib/flush-effects'
import { stripInternalQueries } from './internal-utils'
import type { ComponentsType } from '../build/webpack/loaders/next-app-loader'

// TODO-APP: change to React.use once it becomes stable
const use = (React as any).experimental_use

// this needs to be required lazily so that `next-server` can set
// the env before we require
const ReactDOMServer = shouldUseReactRoot
  ? require('react-dom/server.browser')
  : require('react-dom/server')

export type RenderOptsPartial = {
  err?: Error | null
  dev?: boolean
  serverComponentManifest?: FlightManifest
  serverCSSManifest?: FlightCSSManifest
  supportsDynamicHTML?: boolean
  runtime?: ServerRuntime
  serverComponents?: boolean
  assetPrefix?: string
}

export type RenderOpts = LoadComponentsReturnType & RenderOptsPartial

/**
 * Interop between "export default" and "module.exports".
 */
function interopDefault(mod: any) {
  return mod.default || mod
}

// Shadowing check does not work with TypeScript enums
// eslint-disable-next-line no-shadow
const enum RecordStatus {
  Pending,
  Resolved,
  Rejected,
}

type Record = {
  status: RecordStatus
  // Could hold the existing promise or the resolved Promise
  value: any
}

/**
 * Create data fetching record for Promise.
 */
function createRecordFromThenable(thenable: Promise<any>) {
  const record: Record = {
    status: RecordStatus.Pending,
    value: thenable,
  }
  thenable.then(
    function (value) {
      if (record.status === RecordStatus.Pending) {
        const resolvedRecord = record
        resolvedRecord.status = RecordStatus.Resolved
        resolvedRecord.value = value
      }
    },
    function (err) {
      if (record.status === RecordStatus.Pending) {
        const rejectedRecord = record
        rejectedRecord.status = RecordStatus.Rejected
        rejectedRecord.value = err
      }
    }
  )
  return record
}

/**
 * Read record value or throw Promise if it's not resolved yet.
 */
function readRecordValue(record: Record) {
  if (record.status === RecordStatus.Resolved) {
    return record.value
  } else {
    throw record.value
  }
}

/**
 * Preload data fetching record before it is called during React rendering.
 * If the record is already in the cache returns that record.
 */
function preloadDataFetchingRecord(
  map: Map<string, Record>,
  key: string,
  fetcher: () => Promise<any> | any
) {
  let record = map.get(key)

  if (!record) {
    const thenable = fetcher()
    record = createRecordFromThenable(thenable)
    map.set(key, record)
  }

  return record
}

/**
 * Render Flight stream.
 * This is only used for renderToHTML, the Flight response does not need additional wrappers.
 */
function useFlightResponse(
  writable: WritableStream<Uint8Array>,
  req: ReadableStream<Uint8Array>,
  serverComponentManifest: any,
  flightResponseRef: {
    current: ReturnType<typeof createFromReadableStream> | null
  },
  nonce?: string
) {
  if (flightResponseRef.current) {
    return flightResponseRef.current
  }

  const [renderStream, forwardStream] = readableStreamTee(req)
  flightResponseRef.current = createFromReadableStream(renderStream, {
    moduleMap: serverComponentManifest.__ssr_module_mapping__,
  })

  let bootstrapped = false
  // We only attach CSS chunks to the inlined data.
  const forwardReader = forwardStream.getReader()
  const writer = writable.getWriter()
  const startScriptTag = nonce
    ? `<script nonce=${JSON.stringify(nonce)}>`
    : '<script>'

  function process() {
    forwardReader.read().then(({ done, value }) => {
      if (!bootstrapped) {
        bootstrapped = true
        writer.write(
          encodeText(
            `${startScriptTag}(self.__next_s=self.__next_s||[]).push(${htmlEscapeJsonString(
              JSON.stringify([0])
            )})</script>`
          )
        )
      }
      if (done) {
        flightResponseRef.current = null
        writer.close()
      } else {
        const responsePartial = decodeText(value)
        const scripts = `${startScriptTag}(self.__next_s=self.__next_s||[]).push(${htmlEscapeJsonString(
          JSON.stringify([1, responsePartial])
        )})</script>`

        writer.write(encodeText(scripts))
        process()
      }
    })
  }
  process()

  return flightResponseRef.current
}

/**
 * Create a component that renders the Flight stream.
 * This is only used for renderToHTML, the Flight response does not need additional wrappers.
 */
function createServerComponentRenderer(
  ComponentToRender: React.ComponentType,
  ComponentMod: {
    __next_app_webpack_require__?: any
    __next_rsc__?: {
      __webpack_require__?: any
    }
  },
  {
    transformStream,
    serverComponentManifest,
    serverContexts,
  }: {
    transformStream: TransformStream<Uint8Array, Uint8Array>
    serverComponentManifest: NonNullable<RenderOpts['serverComponentManifest']>
    serverContexts: Array<
      [ServerContextName: string, JSONValue: Object | number | string]
    >
  },
  nonce?: string
) {
  // We need to expose the `__webpack_require__` API globally for
  // react-server-dom-webpack. This is a hack until we find a better way.
  if (ComponentMod.__next_app_webpack_require__ || ComponentMod.__next_rsc__) {
    // @ts-ignore
    globalThis.__next_require__ =
      ComponentMod.__next_app_webpack_require__ ||
      ComponentMod.__next_rsc__?.__webpack_require__

    // @ts-ignore
    globalThis.__next_chunk_load__ = () => Promise.resolve()
  }

  let RSCStream: ReadableStream<Uint8Array>
  const createRSCStream = () => {
    if (!RSCStream) {
      RSCStream = renderToReadableStream(
        <ComponentToRender />,
        serverComponentManifest,
        {
          context: serverContexts,
        }
      )
    }
    return RSCStream
  }

  const flightResponseRef = { current: null }

  const writable = transformStream.writable
  return function ServerComponentWrapper() {
    const reqStream = createRSCStream()
    const response = useFlightResponse(
      writable,
      reqStream,
      serverComponentManifest,
      flightResponseRef,
      nonce
    )
    return use(response)
  }
}

type DynamicParamTypes = 'catchall' | 'optional-catchall' | 'dynamic'
// c = catchall
// oc = optional catchall
// d = dynamic
export type DynamicParamTypesShort = 'c' | 'oc' | 'd'

/**
 * Shorten the dynamic param in order to make it smaller when transmitted to the browser.
 */
function getShortDynamicParamType(
  type: DynamicParamTypes
): DynamicParamTypesShort {
  switch (type) {
    case 'catchall':
      return 'c'
    case 'optional-catchall':
      return 'oc'
    case 'dynamic':
      return 'd'
    default:
      throw new Error('Unknown dynamic param type')
  }
}

/**
 * Segment in the router state.
 */
export type Segment =
  | string
  | [param: string, value: string, type: DynamicParamTypesShort]

/**
 * LoaderTree is generated in next-app-loader.
 */
type LoaderTree = [
  segment: string,
  parallelRoutes: { [parallelRouterKey: string]: LoaderTree },
  components: ComponentsType
]

/**
 * Router state
 */
export type FlightRouterState = [
  segment: Segment,
  parallelRoutes: { [parallelRouterKey: string]: FlightRouterState },
  url?: string,
  refresh?: 'refetch'
]

/**
 * Individual Flight response path
 */
export type FlightSegmentPath =
  // Uses `any` as repeating pattern can't be typed.
  | any[]
  // Looks somewhat like this
  | [
      segment: Segment,
      parallelRouterKey: string,
      segment: Segment,
      parallelRouterKey: string,
      segment: Segment,
      parallelRouterKey: string
    ]

export type FlightDataPath =
  // Uses `any` as repeating pattern can't be typed.
  | any[]
  // Looks somewhat like this
  | [
      // Holds full path to the segment.
      ...FlightSegmentPath,
      /* segment of the rendered slice: */ Segment,
      /* treePatch */ FlightRouterState,
      /* subTreeData: */ React.ReactNode | null // Can be null during prefetch if there's no loading component
    ]

/**
 * The Flight response data
 */
export type FlightData = Array<FlightDataPath> | string

/**
 * Property holding the current subTreeData.
 */
export type ChildProp = {
  /**
   * Null indicates that the tree is partial
   */
  current: React.ReactNode | null
  segment: Segment
}

/**
 * Parse dynamic route segment to type of parameter
 */
function getSegmentParam(segment: string): {
  param: string
  type: DynamicParamTypes
} | null {
  if (segment.startsWith('[[...') && segment.endsWith(']]')) {
    return {
      type: 'optional-catchall',
      param: segment.slice(5, -2),
    }
  }

  if (segment.startsWith('[...') && segment.endsWith(']')) {
    return {
      type: 'catchall',
      param: segment.slice(4, -1),
    }
  }

  if (segment.startsWith('[') && segment.endsWith(']')) {
    return {
      type: 'dynamic',
      param: segment.slice(1, -1),
    }
  }

  return null
}

/**
 * Get inline <link> tags based on server CSS manifest. Only used when rendering to HTML.
 */
function getCssInlinedLinkTags(
  serverComponentManifest: FlightManifest,
  serverCSSManifest: FlightCSSManifest,
  filePath: string
): string[] {
  const layoutOrPageCss =
    serverCSSManifest[filePath] ||
    serverComponentManifest.__client_css_manifest__?.[filePath]

  if (!layoutOrPageCss) {
    return []
  }

  const chunks = new Set<string>()

  for (const css of layoutOrPageCss) {
    const mod = serverComponentManifest[css]
    if (mod) {
      for (const chunk of mod.default.chunks) {
        chunks.add(chunk)
      }
    }
  }

  return [...chunks]
}

function getScriptNonceFromHeader(cspHeaderValue: string): string | undefined {
  const directives = cspHeaderValue
    // Directives are split by ';'.
    .split(';')
    .map((directive) => directive.trim())

  // First try to find the directive for the 'script-src', otherwise try to
  // fallback to the 'default-src'.
  const directive =
    directives.find((dir) => dir.startsWith('script-src')) ||
    directives.find((dir) => dir.startsWith('default-src'))

  // If no directive could be found, then we're done.
  if (!directive) {
    return
  }

  // Extract the nonce from the directive
  const nonce = directive
    .split(' ')
    // Remove the 'strict-src'/'default-src' string, this can't be the nonce.
    .slice(1)
    .map((source) => source.trim())
    // Find the first source with the 'nonce-' prefix.
    .find(
      (source) =>
        source.startsWith("'nonce-") &&
        source.length > 8 &&
        source.endsWith("'")
    )
    // Grab the nonce by trimming the 'nonce-' prefix.
    ?.slice(7, -1)

  // If we could't find the nonce, then we're done.
  if (!nonce) {
    return
  }

  // Don't accept the nonce value if it contains HTML escape characters.
  // Technically, the spec requires a base64'd value, but this is just an
  // extra layer.
  if (ESCAPE_REGEX.test(nonce)) {
    throw new Error(
      'Nonce value from Content-Security-Policy contained HTML escape characters.\nLearn more: https://nextjs.org/docs/messages/nonce-contained-invalid-characters'
    )
  }

  return nonce
}

export async function renderToHTMLOrFlight(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  query: NextParsedUrlQuery,
  renderOpts: RenderOpts,
  isPagesDir: boolean
): Promise<RenderResult | null> {
  // @ts-expect-error createServerContext exists in react@experimental + react-dom@experimental
  if (typeof React.createServerContext === 'undefined') {
    throw new Error(
      '"app" directory requires React.createServerContext which is not available in the version of React you are using. Please update to react@experimental and react-dom@experimental.'
    )
  }

  // don't modify original query object
  query = Object.assign({}, query)

  const {
    buildManifest,
    subresourceIntegrityManifest,
    serverComponentManifest,
    serverCSSManifest = {},
    supportsDynamicHTML,
    ComponentMod,
  } = renderOpts

  const isFlight = query.__flight__ !== undefined
  const isPrefetch = query.__flight_prefetch__ !== undefined

  // Handle client-side navigation to pages directory
  if (isFlight && isPagesDir) {
    stripInternalQueries(query)
    const search = stringifyQuery(query)

    // Empty so that the client-side router will do a full page navigation.
    const flightData: FlightData = pathname + (search ? `?${search}` : '')
    return new RenderResult(
      renderToReadableStream(flightData, serverComponentManifest).pipeThrough(
        createBufferedTransformStream()
      )
    )
  }

  // TODO-APP: verify the tree is valid
  // TODO-APP: verify query param is single value (not an array)
  // TODO-APP: verify tree can't grow out of control
  /**
   * Router state provided from the client-side router. Used to handle rendering from the common layout down.
   */
  const providedFlightRouterState: FlightRouterState = isFlight
    ? query.__flight_router_state_tree__
      ? JSON.parse(query.__flight_router_state_tree__ as string)
      : {}
    : undefined

  stripInternalQueries(query)

  const pageIsDynamic = isDynamicRoute(pathname)
  const LayoutRouter =
    ComponentMod.LayoutRouter as typeof import('../client/components/layout-router.client').default
  const RenderFromTemplateContext =
    ComponentMod.RenderFromTemplateContext as typeof import('../client/components/render-from-template-context.client').default
  const HotReloader = ComponentMod.HotReloader as
    | typeof import('../client/components/hot-reloader.client').default
    | null

  const headers = req.headers
  // TODO-APP: fix type of req
  // @ts-expect-error
  const cookies = req.cookies

  /**
   * The tree created in next-app-loader that holds component segments and modules
   */
  const loaderTree: LoaderTree = ComponentMod.tree

  const tryGetPreviewData =
    process.env.NEXT_RUNTIME === 'edge'
      ? () => false
      : require('./api-utils/node').tryGetPreviewData

  // Reads of this are cached on the `req` object, so this should resolve
  // instantly. There's no need to pass this data down from a previous
  // invoke, where we'd have to consider server & serverless.
  const previewData = tryGetPreviewData(
    req,
    res,
    (renderOpts as any).previewProps
  )
  const isPreview = previewData !== false
  /**
   * Server Context is specifically only available in Server Components.
   * It has to hold values that can't change while rendering from the common layout down.
   * An example of this would be that `headers` are available but `searchParams` are not because that'd mean we have to render from the root layout down on all requests.
   */
  const serverContexts: Array<[string, any]> = [
    ['WORKAROUND', null], // TODO-APP: First value has a bug currently where the value is not set on the second request: https://github.com/facebook/react/issues/24849
    ['HeadersContext', headers],
    ['CookiesContext', cookies],
    ['PreviewDataContext', previewData],
  ]

  /**
   * Used to keep track of in-flight / resolved data fetching Promises.
   */
  const dataCache = new Map<string, Record>()

  type CreateSegmentPath = (child: FlightSegmentPath) => FlightSegmentPath

  /**
   * Dynamic parameters. E.g. when you visit `/dashboard/vercel` which is rendered by `/dashboard/[slug]` the value will be {"slug": "vercel"}.
   */
  const pathParams = (renderOpts as any).params as ParsedUrlQuery

  /**
   * Parse the dynamic segment and return the associated value.
   */
  const getDynamicParamFromSegment = (
    // [slug] / [[slug]] / [...slug]
    segment: string
  ): {
    param: string
    value: string | string[] | null
    treeSegment: Segment
    type: DynamicParamTypesShort
  } | null => {
    const segmentParam = getSegmentParam(segment)
    if (!segmentParam) {
      return null
    }

    const key = segmentParam.param
    const value = pathParams[key]

    if (!value) {
      // Handle case where optional catchall does not have a value, e.g. `/dashboard/[...slug]` when requesting `/dashboard`
      if (segmentParam.type === 'optional-catchall') {
        const type = getShortDynamicParamType(segmentParam.type)
        return {
          param: key,
          value: null,
          type: type,
          // This value always has to be a string.
          treeSegment: [key, '', type],
        }
      }
      return null
    }

    const type = getShortDynamicParamType(segmentParam.type)

    return {
      param: key,
      // The value that is passed to user code.
      value: value,
      // The value that is rendered in the router tree.
      treeSegment: [key, Array.isArray(value) ? value.join('/') : value, type],
      type: type,
    }
  }

  const createFlightRouterStateFromLoaderTree = ([
    segment,
    parallelRoutes,
  ]: LoaderTree): FlightRouterState => {
    const dynamicParam = getDynamicParamFromSegment(segment)

    const segmentTree: FlightRouterState = [
      dynamicParam ? dynamicParam.treeSegment : segment,
      {},
    ]

    if (parallelRoutes) {
      segmentTree[1] = Object.keys(parallelRoutes).reduce(
        (existingValue, currentValue) => {
          existingValue[currentValue] = createFlightRouterStateFromLoaderTree(
            parallelRoutes[currentValue]
          )
          return existingValue
        },
        {} as FlightRouterState[1]
      )
    }

    return segmentTree
  }

  /**
   * Use the provided loader tree to create the React Component tree.
   */
  const createComponentTree = async ({
    createSegmentPath,
    loaderTree: [
      segment,
      parallelRoutes,
      { layoutOrPagePath, layout, template, error, loading, page },
    ],
    parentParams,
    firstItem,
    rootLayoutIncluded,
  }: {
    createSegmentPath: CreateSegmentPath
    loaderTree: LoaderTree
    parentParams: { [key: string]: any }
    rootLayoutIncluded?: boolean
    firstItem?: boolean
  }): Promise<{ Component: React.ComponentType }> => {
    // TODO-APP: enable stylesheet per layout/page
    const stylesheets: string[] = layoutOrPagePath
      ? getCssInlinedLinkTags(
          serverComponentManifest,
          serverCSSManifest!,
          layoutOrPagePath
        )
      : []
    const Template = template
      ? await interopDefault(template())
      : React.Fragment
    const ErrorComponent = error ? await interopDefault(error()) : undefined
    const Loading = loading ? await interopDefault(loading()) : undefined
    const isLayout = typeof layout !== 'undefined'
    const isPage = typeof page !== 'undefined'
    const layoutOrPageMod = isLayout
      ? await layout()
      : isPage
      ? await page()
      : undefined
    /**
     * Checks if the current segment is a root layout.
     */
    const rootLayoutAtThisLevel = isLayout && !rootLayoutIncluded
    /**
     * Checks if the current segment or any level above it has a root layout.
     */
    const rootLayoutIncludedAtThisLevelOrAbove =
      rootLayoutIncluded || rootLayoutAtThisLevel

    /**
     * Check if the current layout/page is a client component
     */
    const isClientComponentModule =
      layoutOrPageMod && !layoutOrPageMod.hasOwnProperty('__next_rsc__')

    /**
     * The React Component to render.
     */
    const Component = layoutOrPageMod
      ? interopDefault(layoutOrPageMod)
      : undefined

    // Handle dynamic segment params.
    const segmentParam = getDynamicParamFromSegment(segment)
    /**
     * Create object holding the parent params and current params, this is passed to getServerSideProps and getStaticProps.
     */
    const currentParams =
      // Handle null case where dynamic param is optional
      segmentParam && segmentParam.value !== null
        ? {
            ...parentParams,
            [segmentParam.param]: segmentParam.value,
          }
        : // Pass through parent params to children
          parentParams
    // Resolve the segment param
    const actualSegment = segmentParam ? segmentParam.treeSegment : segment

    // This happens outside of rendering in order to eagerly kick off data fetching for layouts / the page further down
    const parallelRouteMap = await Promise.all(
      Object.keys(parallelRoutes).map(
        async (parallelRouteKey): Promise<[string, React.ReactNode]> => {
          const currentSegmentPath: FlightSegmentPath = firstItem
            ? [parallelRouteKey]
            : [actualSegment, parallelRouteKey]

          const childSegment = parallelRoutes[parallelRouteKey][0]
          const childSegmentParam = getDynamicParamFromSegment(childSegment)

          if (isPrefetch && Loading) {
            const childProp: ChildProp = {
              // Null indicates the tree is not fully rendered
              current: null,
              segment: childSegmentParam
                ? childSegmentParam.treeSegment
                : childSegment,
            }

            // This is turned back into an object below.
            return [
              parallelRouteKey,
              <LayoutRouter
                parallelRouterKey={parallelRouteKey}
                segmentPath={createSegmentPath(currentSegmentPath)}
                loading={Loading ? <Loading /> : undefined}
                error={ErrorComponent}
                template={
                  <Template>
                    <RenderFromTemplateContext />
                  </Template>
                }
                childProp={childProp}
                rootLayoutIncluded={rootLayoutIncludedAtThisLevelOrAbove}
              />,
            ]
          }

          // Create the child component
          const { Component: ChildComponent } = await createComponentTree({
            createSegmentPath: (child) => {
              return createSegmentPath([...currentSegmentPath, ...child])
            },
            loaderTree: parallelRoutes[parallelRouteKey],
            parentParams: currentParams,
            rootLayoutIncluded: rootLayoutIncludedAtThisLevelOrAbove,
          })

          const childProp: ChildProp = {
            current: <ChildComponent />,
            segment: childSegmentParam
              ? childSegmentParam.treeSegment
              : childSegment,
          }

          const segmentPath = createSegmentPath(currentSegmentPath)

          // This is turned back into an object below.
          return [
            parallelRouteKey,
            <LayoutRouter
              parallelRouterKey={parallelRouteKey}
              segmentPath={segmentPath}
              error={ErrorComponent}
              loading={Loading ? <Loading /> : undefined}
              template={
                <Template>
                  <RenderFromTemplateContext />
                </Template>
              }
              childProp={childProp}
              rootLayoutIncluded={rootLayoutIncludedAtThisLevelOrAbove}
            />,
          ]
        }
      )
    )

    // Convert the parallel route map into an object after all promises have been resolved.
    const parallelRouteComponents = parallelRouteMap.reduce(
      (list, [parallelRouteKey, Comp]) => {
        list[parallelRouteKey] = Comp
        return list
      },
      {} as { [key: string]: React.ReactNode }
    )

    // When the segment does not have a layout or page we still have to add the layout router to ensure the path holds the loading component
    if (!Component) {
      return {
        Component: () => <>{parallelRouteComponents.children}</>,
      }
    }

    const segmentPath = createSegmentPath([actualSegment])
    const dataCacheKey = JSON.stringify(segmentPath)
    let fetcher: (() => Promise<any>) | null = null

    type GetServerSidePropsContext = {
      headers: IncomingHttpHeaders
      cookies: NextApiRequestCookies
      layoutSegments: FlightSegmentPath
      params?: { [key: string]: string | string[] }
      preview?: boolean
      previewData?: string | object | undefined
    }

    type getServerSidePropsContextPage = GetServerSidePropsContext & {
      searchParams: URLSearchParams
      pathname: string
    }

    type GetStaticPropsContext = {
      layoutSegments: FlightSegmentPath
      params?: { [key: string]: string | string[] }
      preview?: boolean
      previewData?: string | object | undefined
    }

    type GetStaticPropContextPage = GetStaticPropsContext & {
      pathname: string
    }

    // TODO-APP: pass a shared cache from previous getStaticProps/getServerSideProps calls?
    if (!isClientComponentModule && layoutOrPageMod.getServerSideProps) {
      // TODO-APP: recommendation for i18n
      // locales: (renderOpts as any).locales, // always the same
      // locale: (renderOpts as any).locale, // /nl/something -> nl
      // defaultLocale: (renderOpts as any).defaultLocale, // changes based on domain
      const getServerSidePropsContext:
        | GetServerSidePropsContext
        | getServerSidePropsContextPage = {
        headers,
        cookies,
        layoutSegments: segmentPath,
        // TODO-APP: change pathname to actual pathname, it holds the dynamic parameter currently
        ...(isPage ? { searchParams: query, pathname } : {}),
        ...(pageIsDynamic ? { params: currentParams } : undefined),
        ...(isPreview
          ? { preview: true, previewData: previewData }
          : undefined),
      }
      fetcher = () =>
        Promise.resolve(
          layoutOrPageMod.getServerSideProps(getServerSidePropsContext)
        )
    }
    // TODO-APP: implement layout specific caching for getStaticProps
    if (!isClientComponentModule && layoutOrPageMod.getStaticProps) {
      const getStaticPropsContext:
        | GetStaticPropsContext
        | GetStaticPropContextPage = {
        layoutSegments: segmentPath,
        ...(isPage ? { pathname } : {}),
        ...(pageIsDynamic ? { params: currentParams } : undefined),
        ...(isPreview
          ? { preview: true, previewData: previewData }
          : undefined),
      }
      fetcher = () =>
        Promise.resolve(layoutOrPageMod.getStaticProps(getStaticPropsContext))
    }

    if (fetcher) {
      // Kick off data fetching before rendering, this ensures there is no waterfall for layouts as
      // all data fetching required to render the page is kicked off simultaneously
      preloadDataFetchingRecord(dataCache, dataCacheKey, fetcher)
    }

    return {
      Component: () => {
        let props
        // The data fetching was kicked off before rendering (see above)
        // if the data was not resolved yet the layout rendering will be suspended
        if (fetcher) {
          const record = preloadDataFetchingRecord(
            dataCache,
            dataCacheKey,
            fetcher
          )
          // Result of calling getStaticProps or getServerSideProps. If promise is not resolve yet it will suspend.
          const recordValue = readRecordValue(record)

          if (props) {
            props = Object.assign({}, props, recordValue.props)
          } else {
            props = recordValue.props
          }
        }

        return (
          <>
            {stylesheets
              ? stylesheets.map((href) => (
                  <link
                    rel="stylesheet"
                    href={`/_next/${href}?ts=${Date.now()}`}
                    // `Precedence` is an opt-in signal for React to handle
                    // resource loading and deduplication, etc:
                    // https://github.com/facebook/react/pull/25060
                    // @ts-ignore
                    precedence="high"
                    key={href}
                  />
                ))
              : null}
            <Component
              {...props}
              {...parallelRouteComponents}
              // TODO-APP: params and query have to be blocked parallel route names. Might have to add a reserved name list.
              // Params are always the current params that apply to the layout
              // If you have a `/dashboard/[team]/layout.js` it will provide `team` as a param but not anything further down.
              params={currentParams}
              // Query is only provided to page
              {...(isPage ? { searchParams: query } : {})}
            />
          </>
        )
      },
    }
  }

  // Handle Flight render request. This is only used when client-side navigating. E.g. when you `router.push('/dashboard')` or `router.reload()`.
  if (isFlight) {
    // TODO-APP: throw on invalid flightRouterState
    /**
     * Use router state to decide at what common layout to render the page.
     * This can either be the common layout between two pages or a specific place to start rendering from using the "refetch" marker in the tree.
     */
    const walkTreeWithFlightRouterState = async (
      loaderTreeToFilter: LoaderTree,
      parentParams: { [key: string]: string | string[] },
      flightRouterState?: FlightRouterState,
      parentRendered?: boolean
    ): Promise<FlightDataPath> => {
      const [segment, parallelRoutes] = loaderTreeToFilter
      const parallelRoutesKeys = Object.keys(parallelRoutes)

      // Because this function walks to a deeper point in the tree to start rendering we have to track the dynamic parameters up to the point where rendering starts
      // That way even when rendering the subtree getServerSideProps/getStaticProps get the right parameters.
      const segmentParam = getDynamicParamFromSegment(segment)
      const currentParams =
        // Handle null case where dynamic param is optional
        segmentParam && segmentParam.value !== null
          ? {
              ...parentParams,
              [segmentParam.param]: segmentParam.value,
            }
          : parentParams
      const actualSegment: Segment = segmentParam
        ? segmentParam.treeSegment
        : segment

      /**
       * Decide if the current segment is where rendering has to start.
       */
      const renderComponentsOnThisLevel =
        // No further router state available
        !flightRouterState ||
        // Segment in router state does not match current segment
        !matchSegment(actualSegment, flightRouterState[0]) ||
        // Last item in the tree
        parallelRoutesKeys.length === 0 ||
        // Explicit refresh
        flightRouterState[3] === 'refetch'

      if (!parentRendered && renderComponentsOnThisLevel) {
        return [
          actualSegment,
          // Create router state using the slice of the loaderTree
          createFlightRouterStateFromLoaderTree(loaderTreeToFilter),
          // Check if one level down from the common layout has a loading component. If it doesn't only provide the router state as part of the Flight data.
          isPrefetch && !Boolean(loaderTreeToFilter[2].loading)
            ? null
            : // Create component tree using the slice of the loaderTree
              React.createElement(
                (
                  await createComponentTree(
                    // This ensures flightRouterPath is valid and filters down the tree
                    {
                      createSegmentPath: (child) => child,
                      loaderTree: loaderTreeToFilter,
                      parentParams: currentParams,
                      firstItem: true,
                    }
                  )
                ).Component
              ),
        ]
      }

      // Walk through all parallel routes.
      for (const parallelRouteKey of parallelRoutesKeys) {
        const parallelRoute = parallelRoutes[parallelRouteKey]
        const path = await walkTreeWithFlightRouterState(
          parallelRoute,
          currentParams,
          flightRouterState && flightRouterState[1][parallelRouteKey],
          parentRendered || renderComponentsOnThisLevel
        )

        if (typeof path[path.length - 1] !== 'string') {
          return [actualSegment, parallelRouteKey, ...path]
        }
      }

      return [actualSegment]
    }

    // Flight data that is going to be passed to the browser.
    // Currently a single item array but in the future multiple patches might be combined in a single request.
    const flightData: FlightData = [
      // TODO-APP: change walk to output without ''
      (
        await walkTreeWithFlightRouterState(
          loaderTree,
          {},
          providedFlightRouterState
        )
      ).slice(1),
    ]

    return new RenderResult(
      renderToReadableStream(flightData, serverComponentManifest, {
        context: serverContexts,
      }).pipeThrough(createBufferedTransformStream())
    )
  }

  // Below this line is handling for rendering to HTML.

  // Create full component tree from root to leaf.
  const { Component: ComponentTree } = await createComponentTree({
    createSegmentPath: (child) => child,
    loaderTree: loaderTree,
    parentParams: {},
    firstItem: true,
  })

  // AppRouter is provided by next-app-loader
  const AppRouter =
    ComponentMod.AppRouter as typeof import('../client/components/app-router.client').default

  let serverComponentsInlinedTransformStream: TransformStream<
    Uint8Array,
    Uint8Array
  > = new TransformStream()

  // TODO-APP: validate req.url as it gets passed to render.
  const initialCanonicalUrl = req.url!

  // Get the nonce from the incomming request if it has one.
  const csp = req.headers['content-security-policy']
  let nonce: string | undefined
  if (csp && typeof csp === 'string') {
    nonce = getScriptNonceFromHeader(csp)
  }

  /**
   * A new React Component that renders the provided React Component
   * using Flight which can then be rendered to HTML.
   */
  const ServerComponentsRenderer = createServerComponentRenderer(
    () => {
      const initialTree = createFlightRouterStateFromLoaderTree(loaderTree)

      return (
        <AppRouter
          hotReloader={
            HotReloader && (
              <HotReloader assetPrefix={renderOpts.assetPrefix || ''} />
            )
          }
          initialCanonicalUrl={initialCanonicalUrl}
          initialTree={initialTree}
        >
          <ComponentTree />
        </AppRouter>
      )
    },
    ComponentMod,
    {
      transformStream: serverComponentsInlinedTransformStream,
      serverComponentManifest,
      serverContexts,
    },
    nonce
  )

  const flushEffectsCallbacks: Set<() => React.ReactNode> = new Set()
  function FlushEffects({ children }: { children: JSX.Element }) {
    // Reset flushEffectsHandler on each render
    flushEffectsCallbacks.clear()
    const addFlushEffects = React.useCallback(
      (handler: () => React.ReactNode) => {
        flushEffectsCallbacks.add(handler)
      },
      []
    )

    return (
      <FlushEffectsContext.Provider value={addFlushEffects}>
        {children}
      </FlushEffectsContext.Provider>
    )
  }

  /**
   * Rules of Static & Dynamic HTML:
   *
   *    1.) We must generate static HTML unless the caller explicitly opts
   *        in to dynamic HTML support.
   *
   *    2.) If dynamic HTML support is requested, we must honor that request
   *        or throw an error. It is the sole responsibility of the caller to
   *        ensure they aren't e.g. requesting dynamic HTML for an AMP page.
   *
   * These rules help ensure that other existing features like request caching,
   * coalescing, and ISR continue working as intended.
   */
  const generateStaticHTML = supportsDynamicHTML !== true
  const bodyResult = async () => {
    const content = (
      <FlushEffects>
        <ServerComponentsRenderer />
      </FlushEffects>
    )

    const flushEffectHandler = (): string => {
      const flushed = ReactDOMServer.renderToString(
        <>{Array.from(flushEffectsCallbacks).map((callback) => callback())}</>
      )
      return flushed
    }

    try {
      const renderStream = await renderToInitialStream({
        ReactDOMServer,
        element: content,
        streamOptions: {
          nonce,
          // Include hydration scripts in the HTML
          bootstrapScripts: subresourceIntegrityManifest
            ? buildManifest.rootMainFiles.map((src) => ({
                src: `${renderOpts.assetPrefix || ''}/_next/` + src,
                integrity: subresourceIntegrityManifest[src],
              }))
            : buildManifest.rootMainFiles.map(
                (src) => `${renderOpts.assetPrefix || ''}/_next/` + src
              ),
        },
      })

      return await continueFromInitialStream(renderStream, {
        dataStream: serverComponentsInlinedTransformStream?.readable,
        generateStaticHTML: generateStaticHTML,
        flushEffectHandler,
        flushEffectsToHead: true,
      })
    } catch (err) {
      // TODO-APP: show error overlay in development. `element` should probably be wrapped in AppRouter for this case.
      const renderStream = await renderToInitialStream({
        ReactDOMServer,
        element: (
          <html id="__next_error__">
            <head></head>
            <body></body>
          </html>
        ),
        streamOptions: {
          nonce,
          // Include hydration scripts in the HTML
          bootstrapScripts: subresourceIntegrityManifest
            ? buildManifest.rootMainFiles.map((src) => ({
                src: `${renderOpts.assetPrefix || ''}/_next/` + src,
                integrity: subresourceIntegrityManifest[src],
              }))
            : buildManifest.rootMainFiles.map(
                (src) => `${renderOpts.assetPrefix || ''}/_next/` + src
              ),
        },
      })

      return await continueFromInitialStream(renderStream, {
        dataStream: serverComponentsInlinedTransformStream?.readable,
        generateStaticHTML: generateStaticHTML,
        flushEffectHandler,
        flushEffectsToHead: true,
      })
    }
  }

  return new RenderResult(await bodyResult())
}
