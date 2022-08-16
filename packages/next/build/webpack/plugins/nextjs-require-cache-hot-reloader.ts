import type { webpack } from 'next/dist/compiled/webpack/webpack'
import { clearModuleContext } from '../../../server/web/sandbox'
import { realpathSync } from 'fs'
import path from 'path'
import isError from '../../../lib/is-error'

type Compiler = webpack.Compiler
type WebpackPluginInstance = webpack.WebpackPluginInstance

const originModules = [
  require.resolve('../../../server/require'),
  require.resolve('../../../server/load-components'),
]

const RUNTIME_NAMES = ['webpack-runtime', 'webpack-api-runtime']

function deleteCache(filePath: string) {
  try {
    filePath = realpathSync(filePath)
  } catch (e) {
    if (isError(e) && e.code !== 'ENOENT') throw e
  }
  const mod = require.cache[filePath]
  if (mod) {
    // remove the child reference from the originModules
    for (const originModule of originModules) {
      const parent = require.cache[originModule]
      if (parent) {
        const idx = parent.children.indexOf(mod)
        if (idx >= 0) parent.children.splice(idx, 1)
      }
    }
    // remove parent references from external modules
    for (const child of mod.children) {
      child.parent = null
    }
    delete require.cache[filePath]
    return true
  }
  return false
}

const PLUGIN_NAME = 'NextJsRequireCacheHotReloader'

// This plugin flushes require.cache after emitting the files. Providing 'hot reloading' of server files.
export class NextJsRequireCacheHotReloader implements WebpackPluginInstance {
  prevAssets: any = null
  hasServerComponents: boolean

  constructor(opts: { hasServerComponents: boolean }) {
    this.hasServerComponents = opts.hasServerComponents
  }

  apply(compiler: Compiler) {
    compiler.hooks.assetEmitted.tap(
      PLUGIN_NAME,
      (_file, { targetPath, content }) => {
        deleteCache(targetPath)
        clearModuleContext(targetPath, content.toString('utf-8'))
      }
    )

    compiler.hooks.afterEmit.tap(PLUGIN_NAME, (compilation) => {
      RUNTIME_NAMES.forEach((name) => {
        const runtimeChunkPath = path.join(
          compilation.outputOptions.path!,
          `${name}.js`
        )
        deleteCache(runtimeChunkPath)
      })

      // we need to make sure to clear all server entries from cache
      // since they can have a stale webpack-runtime cache
      // which needs to always be in-sync
      const entries = [...compilation.entries.keys()].filter(
        (entry) =>
          entry.toString().startsWith('pages/') ||
          entry.toString().startsWith('app/')
      )

      entries.forEach((page) => {
        const outputPath = path.join(
          compilation.outputOptions.path!,
          page + '.js'
        )
        deleteCache(outputPath)
      })
    })
  }
}
