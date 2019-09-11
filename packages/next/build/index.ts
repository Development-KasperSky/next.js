import chalk from 'chalk'
import fs from 'fs'
import mkdirpOrig from 'mkdirp'
import {
  PAGES_MANIFEST,
  PHASE_PRODUCTION_BUILD,
  PRERENDER_MANIFEST,
  SERVER_DIRECTORY,
  SERVERLESS_DIRECTORY,
} from '../next-server/lib/constants'
import loadConfig, {
  isTargetLikeServerless,
} from '../next-server/server/config'
import nanoid from 'next/dist/compiled/nanoid/index.js'
import path from 'path'
import { promisify } from 'util'
import Worker from 'jest-worker'

import formatWebpackMessages from '../client/dev/error-overlay/format-webpack-messages'
import { recursiveDelete } from '../lib/recursive-delete'
import { verifyTypeScriptSetup } from '../lib/verifyTypeScriptSetup'
import {
  recordBuildDuration,
  recordBuildOptimize,
  recordNextPlugins,
  recordVersion,
} from '../telemetry/events'
import { CompilerResult, runCompiler } from './compiler'
import { createEntrypoints, createPagesMapping } from './entries'
import { generateBuildId } from './generate-build-id'
import { isWriteable } from './is-writeable'
import {
  collectPages,
  getPageSizeInKb,
  hasCustomAppGetInitialProps,
  PageInfo,
  printTreeView,
} from './utils'
import getBaseWebpackConfig from './webpack-config'
import { getPageChunks } from './webpack/plugins/chunk-graph-plugin'
import { writeBuildId } from './write-build-id'

const fsUnlink = promisify(fs.unlink)
const fsRmdir = promisify(fs.rmdir)
const fsMove = promisify(fs.rename)
const fsReadFile = promisify(fs.readFile)
const fsWriteFile = promisify(fs.writeFile)
const mkdirp = promisify(mkdirpOrig)

const staticCheckWorker = require.resolve('./static-checker')

export type PrerenderFile = {
  lambda: string
  contentTypes: string[]
}

export default async function build(dir: string, conf = null): Promise<void> {
  if (!(await isWriteable(dir))) {
    throw new Error(
      '> Build directory is not writeable. https://err.sh/zeit/next.js/build-dir-not-writeable'
    )
  }

  await verifyTypeScriptSetup(dir)

  let backgroundWork: (Promise<any> | undefined)[] = []
  backgroundWork.push(
    recordVersion({ cliCommand: 'build' }),
    recordNextPlugins(path.resolve(dir))
  )

  console.log('Creating an optimized production build ...')
  console.log()

  const config = loadConfig(PHASE_PRODUCTION_BUILD, dir, conf)
  const { target } = config
  const buildId = await generateBuildId(config.generateBuildId, nanoid)
  const distDir = path.join(dir, config.distDir)
  const pagesDir = path.join(dir, 'pages')

  let tracer: any = null
  if (config.experimental.profiling) {
    const { createTrace } = require('./profiler/profiler.js')
    tracer = createTrace(path.join(distDir, `profile-events.json`))
    tracer.profiler.startProfiling()
  }

  const isLikeServerless = isTargetLikeServerless(target)

  const pagePaths: string[] = await collectPages(
    pagesDir,
    config.pageExtensions
  )

  // needed for static exporting since we want to replace with HTML
  // files
  const allStaticPages = new Set<string>()
  let allPageInfos = new Map<string, PageInfo>()

  const mappedPages = createPagesMapping(pagePaths, config.pageExtensions)
  const entrypoints = createEntrypoints(mappedPages, target, buildId, config)
  const configs = await Promise.all([
    getBaseWebpackConfig(dir, {
      tracer,
      buildId,
      isServer: false,
      config,
      target,
      entrypoints: entrypoints.client,
    }),
    getBaseWebpackConfig(dir, {
      tracer,
      buildId,
      isServer: true,
      config,
      target,
      entrypoints: entrypoints.server,
    }),
  ])

  const clientConfig = configs[0]

  if (
    clientConfig.optimization &&
    (clientConfig.optimization.minimize !== true ||
      (clientConfig.optimization.minimizer &&
        clientConfig.optimization.minimizer.length === 0))
  ) {
    console.warn(
      chalk.bold.yellow(`Warning: `) +
        chalk.bold(
          `Production code optimization has been disabled in your project. Read more: https://err.sh/zeit/next.js/minification-disabled`
        )
    )
  }

  const webpackBuildStart = process.hrtime()

  let result: CompilerResult = { warnings: [], errors: [] }
  // TODO: why do we need this?? https://github.com/zeit/next.js/issues/8253
  if (isLikeServerless) {
    const clientResult = await runCompiler(clientConfig)
    // Fail build if clientResult contains errors
    if (clientResult.errors.length > 0) {
      result = {
        warnings: [...clientResult.warnings],
        errors: [...clientResult.errors],
      }
    } else {
      const serverResult = await runCompiler(configs[1])
      result = {
        warnings: [...clientResult.warnings, ...serverResult.warnings],
        errors: [...clientResult.errors, ...serverResult.errors],
      }
    }
  } else {
    result = await runCompiler(configs)
  }

  const webpackBuildEnd = process.hrtime(webpackBuildStart)

  result = formatWebpackMessages(result)

  if (result.errors.length > 0) {
    // Only keep the first error. Others are often indicative
    // of the same problem, but confuse the reader with noise.
    if (result.errors.length > 1) {
      result.errors.length = 1
    }
    const error = result.errors.join('\n\n')

    console.error(chalk.red('Failed to compile.\n'))

    if (
      error.indexOf('private-next-pages') > -1 &&
      error.indexOf('does not contain a default export') > -1
    ) {
      const page_name_regex = /\'private-next-pages\/(?<page_name>[^\']*)\'/
      const parsed = page_name_regex.exec(error)
      const page_name = parsed && parsed.groups && parsed.groups.page_name
      throw new Error(
        `webpack build failed: found page without a React Component as default export in pages/${page_name}\n\nSee https://err.sh/zeit/next.js/page-without-valid-component for more info.`
      )
    }

    console.error(error)
    console.error()

    if (error.indexOf('private-next-pages') > -1) {
      throw new Error(
        '> webpack config.resolve.alias was incorrectly overriden. https://err.sh/zeit/next.js/invalid-resolve-alias'
      )
    }
    throw new Error('> Build failed because of webpack errors')
  } else if (result.warnings.length > 0) {
    console.warn(chalk.yellow('Compiled with warnings.\n'))
    console.warn(result.warnings.join('\n\n'))
    console.warn()
  } else {
    console.log(chalk.green('Compiled successfully.\n'))
    backgroundWork.push(
      recordBuildDuration({
        totalPageCount: pagePaths.length,
        durationInSeconds: webpackBuildEnd[0],
      })
    )
  }

  const pageKeys = Object.keys(mappedPages)
  const manifestPath = path.join(
    distDir,
    isLikeServerless ? SERVERLESS_DIRECTORY : SERVER_DIRECTORY,
    PAGES_MANIFEST
  )

  const sprPages = new Set<string>()
  const staticPages = new Set<string>()
  const invalidPages = new Set<string>()
  const hybridAmpPages = new Set<string>()
  const pageInfos = new Map<string, PageInfo>()
  const pagesManifest = JSON.parse(await fsReadFile(manifestPath, 'utf8'))
  let customAppGetInitialProps: boolean | undefined

  process.env.NEXT_PHASE = PHASE_PRODUCTION_BUILD

  const staticCheckWorkers = new Worker(staticCheckWorker, {
    numWorkers: config.experimental.cpus,
    enableWorkerThreads: true,
  })

  const analysisBegin = process.hrtime()
  await Promise.all(
    pageKeys.map(async page => {
      const chunks = getPageChunks(page)

      const actualPage = page === '/' ? '/index' : page
      const size = await getPageSizeInKb(actualPage, distDir, buildId)
      const bundleRelative = path.join(
        isLikeServerless ? 'pages' : `static/${buildId}/pages`,
        actualPage + '.js'
      )
      const serverBundle = path.join(
        distDir,
        isLikeServerless ? SERVERLESS_DIRECTORY : SERVER_DIRECTORY,
        bundleRelative
      )

      let isStatic = false

      pagesManifest[page] = bundleRelative.replace(/\\/g, '/')

      const runtimeEnvConfig = {
        publicRuntimeConfig: config.publicRuntimeConfig,
        serverRuntimeConfig: config.serverRuntimeConfig,
      }
      const nonReservedPage = !page.match(/^\/(_app|_error|_document|api)/)

      if (nonReservedPage && customAppGetInitialProps === undefined) {
        customAppGetInitialProps = hasCustomAppGetInitialProps(
          isLikeServerless
            ? serverBundle
            : path.join(
                distDir,
                SERVER_DIRECTORY,
                `/static/${buildId}/pages/_app.js`
              ),
          runtimeEnvConfig
        )

        if (customAppGetInitialProps) {
          console.warn(
            chalk.bold.yellow(`Warning: `) +
              chalk.yellow(
                `You have opted-out of Automatic Prerendering due to \`getInitialProps\` in \`pages/_app\`.`
              )
          )
          console.warn(
            'Read more: https://err.sh/next.js/opt-out-automatic-prerendering\n'
          )
        }
      }

      if (nonReservedPage) {
        try {
          let result: any = await (staticCheckWorkers as any).default({
            serverBundle,
            runtimeEnvConfig,
          })

          if (result.isHybridAmp) {
            hybridAmpPages.add(page)
          }

          if (result.static && customAppGetInitialProps === false) {
            staticPages.add(page)
            isStatic = true
          } else if (result.prerender) {
            sprPages.add(page)
          }
        } catch (err) {
          if (err.message !== 'INVALID_DEFAULT_EXPORT') throw err
          invalidPages.add(page)
        }
      }

      pageInfos.set(page, { size, chunks, serverBundle, static: isStatic })
    })
  )
  staticCheckWorkers.end()

  if (invalidPages.size > 0) {
    throw new Error(
      `automatic static optimization failed: found page${
        invalidPages.size === 1 ? '' : 's'
      } without a React Component as default export in \n${[...invalidPages]
        .map(pg => `pages${pg}`)
        .join(
          '\n'
        )}\n\nSee https://err.sh/zeit/next.js/page-without-valid-component for more info.\n`
    )
  }

  if (Array.isArray(configs[0].plugins)) {
    configs[0].plugins.some((plugin: any) => {
      if (!plugin.ampPages) {
        return false
      }

      plugin.ampPages.forEach((pg: any) => {
        pageInfos.get(pg)!.isAmp = true
      })
      return true
    })
  }

  await writeBuildId(distDir, buildId)
  const prerenderFiles: { [path: string]: PrerenderFile } = {}

  if (staticPages.size > 0 || sprPages.size > 0) {
    const combinedPages = [...staticPages, ...sprPages]
    const exportApp = require('../export').default
    const exportOptions = {
      sprPages,
      silent: true,
      buildExport: true,
      pages: combinedPages,
      outdir: path.join(distDir, 'export'),
    }
    const exportConfig = {
      ...config,
      exportPathMap: (defaultMap: any) => defaultMap,
      exportTrailingSlash: false,
    }
    await exportApp(dir, exportOptions, exportConfig)

    // remove server bundles that were exported
    for (const page of staticPages) {
      const { serverBundle } = pageInfos.get(page)!
      await fsUnlink(serverBundle)
    }

    const moveExportedPage = async (page: string, file: string) => {
      const isSpr = sprPages.has(page)
      file = `${file}.html`
      const orig = path.join(exportOptions.outdir, file)
      const relativeDest = (isLikeServerless
        ? path.join('pages', file)
        : path.join('static', buildId, 'pages', file)
      ).replace(/\\/g, '/')

      const dest = path.join(
        distDir,
        isLikeServerless ? SERVERLESS_DIRECTORY : SERVER_DIRECTORY,
        relativeDest
      )

      if (isSpr) {
        const projectRelativeDest = path.join(
          config.distDir,
          isLikeServerless ? SERVERLESS_DIRECTORY : SERVER_DIRECTORY,
          relativeDest
        )
        prerenderFiles[projectRelativeDest] = {
          lambda: projectRelativeDest.replace(/\.html$/, '.js'),
          contentTypes: ['application/json', 'text/html'],
        }
      } else {
        pagesManifest[page] = relativeDest
        if (page === '/') pagesManifest['/index'] = relativeDest
        if (page === '/.amp') pagesManifest['/index.amp'] = relativeDest
      }
      await mkdirp(path.dirname(dest))
      await fsMove(orig, dest)
    }

    for (const page of combinedPages) {
      let file = page === '/' ? '/index' : page
      await moveExportedPage(page, file)
      const hasAmp = hybridAmpPages.has(page)
      if (hasAmp) await moveExportedPage(`${page}.amp`, `${file}.amp`)
    }

    // remove temporary export folder
    await recursiveDelete(exportOptions.outdir)
    await fsRmdir(exportOptions.outdir)
    await fsWriteFile(manifestPath, JSON.stringify(pagesManifest), 'utf8')
  }

  const analysisEnd = process.hrtime(analysisBegin)
  backgroundWork.push(
    recordBuildOptimize({
      durationInSeconds: analysisEnd[0],
      totalPageCount: pagePaths.length,
      staticPageCount: staticPages.size,
      ssrPageCount: pagePaths.length - staticPages.size,
    })
  )

  if (sprPages.size > 0) {
    await fsWriteFile(
      path.join(distDir, PRERENDER_MANIFEST),
      JSON.stringify({ prerenderFiles }),
      'utf8'
    )
  }

  staticPages.forEach(pg => allStaticPages.add(pg))
  pageInfos.forEach((info: PageInfo, key: string) => {
    allPageInfos.set(key, info)
  })

  printTreeView(Object.keys(mappedPages), allPageInfos, isLikeServerless)

  if (tracer) {
    const parsedResults = await tracer.profiler.stopProfiling()
    await new Promise(resolve => {
      if (parsedResults === undefined) {
        tracer.profiler.destroy()
        tracer.trace.flush()
        tracer.end(resolve)
        return
      }

      const cpuStartTime = parsedResults.profile.startTime
      const cpuEndTime = parsedResults.profile.endTime

      tracer.trace.completeEvent({
        name: 'TaskQueueManager::ProcessTaskFromWorkQueue',
        id: ++tracer.counter,
        cat: ['toplevel'],
        ts: cpuStartTime,
        args: {
          src_file: '../../ipc/ipc_moji_bootstrap.cc',
          src_func: 'Accept',
        },
      })

      tracer.trace.completeEvent({
        name: 'EvaluateScript',
        id: ++tracer.counter,
        cat: ['devtools.timeline'],
        ts: cpuStartTime,
        dur: cpuEndTime - cpuStartTime,
        args: {
          data: {
            url: 'webpack',
            lineNumber: 1,
            columnNumber: 1,
            frame: '0xFFF',
          },
        },
      })

      tracer.trace.instantEvent({
        name: 'CpuProfile',
        id: ++tracer.counter,
        cat: ['disabled-by-default-devtools.timeline'],
        ts: cpuEndTime,
        args: {
          data: {
            cpuProfile: parsedResults.profile,
          },
        },
      })

      tracer.profiler.destroy()
      tracer.trace.flush()
      tracer.end(resolve)
    })
  }

  await Promise.all(backgroundWork).catch(() => {})
}
