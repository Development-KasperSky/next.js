import type { NextConfig } from '../../../../server/config-shared'
import type { DocumentType, AppType } from '../../../../shared/lib/utils'
import type { BuildManifest } from '../../../../server/get-page-files'
import type { ReactLoadableManifest } from '../../../../server/load-components'

import WebServer from '../../../../server/web-server'
import {
  WebNextRequest,
  WebNextResponse,
} from '../../../../server/base-http/web'
import { SERVER_RUNTIME } from '../../../../lib/constants'

export function getRender({
  dev,
  page,
  appMod,
  pageMod,
  errorMod,
  error500Mod,
  Document,
  buildManifest,
  reactLoadableManifest,
  appRenderToHTML,
  pagesRenderToHTML,
  serverComponentManifest,
  subresourceIntegrityManifest,
  serverCSSManifest,
  config,
  buildId,
}: {
  dev: boolean
  page: string
  appMod: any
  pageMod: any
  errorMod: any
  error500Mod: any
  appRenderToHTML: any
  pagesRenderToHTML: any
  Document: DocumentType
  buildManifest: BuildManifest
  reactLoadableManifest: ReactLoadableManifest
  subresourceIntegrityManifest?: Record<string, string>
  serverComponentManifest: any
  serverCSSManifest: any
  appServerMod: any
  config: NextConfig
  buildId: string
}) {
  const baseLoadComponentResult = {
    dev,
    buildManifest,
    reactLoadableManifest,
    subresourceIntegrityManifest,
    Document,
    App: appMod.default as AppType,
  }

  const server = new WebServer({
    dev,
    conf: config,
    minimalMode: true,
    webServerConfig: {
      page,
      extendRenderOpts: {
        buildId,
        runtime: SERVER_RUNTIME.edge,
        supportsDynamicHTML: true,
        disableOptimizedLoading: true,
        serverComponentManifest,
        serverCSSManifest,
      },
      appRenderToHTML,
      pagesRenderToHTML,
      loadComponent: async (pathname) => {
        if (pathname === page) {
          return {
            ...baseLoadComponentResult,
            Component: pageMod.default,
            pageConfig: pageMod.config || {},
            getStaticProps: pageMod.getStaticProps,
            getServerSideProps: pageMod.getServerSideProps,
            getStaticPaths: pageMod.getStaticPaths,
            ComponentMod: pageMod,
          }
        }

        // If there is a custom 500 page, we need to handle it separately.
        if (pathname === '/500' && error500Mod) {
          return {
            ...baseLoadComponentResult,
            Component: error500Mod.default,
            pageConfig: error500Mod.config || {},
            getStaticProps: error500Mod.getStaticProps,
            getServerSideProps: error500Mod.getServerSideProps,
            getStaticPaths: error500Mod.getStaticPaths,
            ComponentMod: error500Mod,
          }
        }

        if (pathname === '/_error') {
          return {
            ...baseLoadComponentResult,
            Component: errorMod.default,
            pageConfig: errorMod.config || {},
            getStaticProps: errorMod.getStaticProps,
            getServerSideProps: errorMod.getServerSideProps,
            getStaticPaths: errorMod.getStaticPaths,
            ComponentMod: errorMod,
          }
        }

        return null
      },
    },
  })
  const requestHandler = server.getRequestHandler()

  return async function render(request: Request) {
    const extendedReq = new WebNextRequest(request)
    const extendedRes = new WebNextResponse()
    requestHandler(extendedReq, extendedRes)
    return await extendedRes.toResponse()
  }
}
