import { webpack } from 'next/dist/compiled/webpack/webpack'
import { ConfigurationContext } from '../../../utils'
import { getClientStyleLoader } from './client'
import { cssFileResolve } from './file-resolve'

export function getFontLoader(
  ctx: ConfigurationContext,
  postcss: any,
  fontLoaderOptions: any
): webpack.RuleSetUseItem[] {
  const loaders: webpack.RuleSetUseItem[] = []

  if (ctx.isClient) {
    // Add appropriate development mode or production mode style
    // loader
    loaders.push(
      getClientStyleLoader({
        hasAppDir: ctx.hasAppDir,
        isDevelopment: ctx.isDevelopment,
        assetPrefix: ctx.assetPrefix,
      })
    )
  }

  loaders.push({
    loader: require.resolve('../../../../loaders/css-loader/src'),
    options: {
      postcss,
      importLoaders: 1,
      // Use CJS mode for backwards compatibility:
      esModule: false,
      url: (url: string, resourcePath: string) =>
        cssFileResolve(url, resourcePath, ctx.experimental.urlImports),
      import: (url: string, _: any, resourcePath: string) =>
        cssFileResolve(url, resourcePath, ctx.experimental.urlImports),
      modules: {
        // Do not transform class names (CJS mode backwards compatibility):
        exportLocalsConvention: 'asIs',
        // Server-side (Node.js) rendering support:
        exportOnlyLocals: ctx.isServer,
        // Disallow global style exports so we can code-split CSS and
        // not worry about loading order.
        mode: 'pure',
        getLocalIdent: (
          _context: any,
          _localIdentName: any,
          exportName: string,
          _options: any,
          meta: any
        ) => {
          // hash from next-font-loader
          return `__${exportName}_${meta.fontFamilyHash}`
        },
      },
      fontLoader: true,
    },
  })

  loaders.push({
    loader: 'next-font-loader',
    options: {
      isServer: ctx.isServer,
      assetPrefix: ctx.assetPrefix,
      fontLoaderOptions,
      postcss,
    },
  })

  return loaders
}
