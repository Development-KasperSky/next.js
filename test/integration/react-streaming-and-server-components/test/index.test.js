/* eslint-env jest */

import { join } from 'path'
import fs from 'fs-extra'
import webdriver from 'next-webdriver'

import { fetchViaHTTP, findPort, killApp, renderViaHTTP } from 'next-test-utils'

import {
  nextBuild,
  nextStart,
  nextDev,
  appDir,
  nativeModuleTestAppDir,
  distDir,
  documentPage,
  appPage,
  appServerPage,
  error500Page,
  nextConfig,
} from './utils'

import css from './css'
import rsc from './rsc'
import streaming from './streaming'
import basic from './basic'
import functions from './functions'

const documentWithGip = `
import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html>
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}

Document.getInitialProps = (ctx) => {
  return ctx.defaultGetInitialProps(ctx)
}
`

const rscAppPage = `
import Container from '../components/container.server'
export default function App({children}) {
  return <Container>{children}</Container>
}
`

const appWithGlobalCss = `
import '../styles.css'

function App({ Component, pageProps }) {
  return <Component {...pageProps} />
}

export default App
`

const page500 = `
export default function Page500() {
  return 'custom-500-page'
}
`

describe('Edge runtime - errors', () => {
  it('should warn user that native node APIs are not supported', async () => {
    const fsImportedErrorMessage =
      'Native Node.js APIs are not supported in the Edge Runtime. Found `dns` imported.'
    const { stderr } = await nextBuild(nativeModuleTestAppDir)
    expect(stderr).toContain(fsImportedErrorMessage)
  })
})

describe('Edge runtime - prod', () => {
  const context = { appDir }

  beforeAll(async () => {
    error500Page.write(page500)
    context.appPort = await findPort()
    const { stderr } = await nextBuild(context.appDir)
    context.stderr = stderr
    context.server = await nextStart(context.appDir, context.appPort)
  })
  afterAll(async () => {
    error500Page.delete()
    await killApp(context.server)
  })

  it('should warn user for experimental risk with edge runtime and server components', async () => {
    const edgeRuntimeWarning =
      'You are using the experimental Edge Runtime with `experimental.runtime`.'
    const rscWarning = `You have experimental React Server Components enabled. Continue at your own risk.`
    expect(context.stderr).toContain(edgeRuntimeWarning)
    expect(context.stderr).toContain(rscWarning)
  })

  it('should generate middleware SSR manifests for edge runtime', async () => {
    const distServerDir = join(distDir, 'server')
    const files = [
      'middleware-build-manifest.js',
      'middleware-flight-manifest.js',
      'middleware-ssr-runtime.js',
      'middleware-manifest.json',
    ]

    const requiredServerFiles = (
      await fs.readJSON(join(distDir, 'required-server-files.json'))
    ).files

    files.forEach((file) => {
      const filepath = join(distServerDir, file)
      expect(fs.existsSync(filepath)).toBe(true)
    })

    requiredServerFiles.forEach((file) => {
      const requiredFilePath = join(appDir, file)
      expect(fs.existsSync(requiredFilePath)).toBe(true)
    })
  })

  it('should have clientInfo in middleware manifest', async () => {
    const middlewareManifestPath = join(
      distDir,
      'server',
      'middleware-manifest.json'
    )
    const content = JSON.parse(
      await fs.readFile(middlewareManifestPath, 'utf8')
    )
    for (const item of [
      ['/', true],
      ['/next-api/image', true],
      ['/next-api/link', true],
      ['/routes/[dynamic]', true],
    ]) {
      expect(content.clientInfo).toContainEqual(item)
    }
    expect(content.clientInfo).not.toContainEqual([['/404', true]])
  })

  it('should support React.lazy and dynamic imports', async () => {
    const html = await renderViaHTTP(context.appPort, '/dynamic-imports')
    expect(html).toContain('foo.client')
  })

  basic(context, { env: 'prod' })
  streaming(context)
  rsc(context, { runtime: 'edge', env: 'prod' })
})

describe('Edge runtime - dev', () => {
  const context = { appDir }

  beforeAll(async () => {
    error500Page.write(page500)
    context.appPort = await findPort()
    context.server = await nextDev(context.appDir, context.appPort)
  })
  afterAll(async () => {
    error500Page.delete()
    await killApp(context.server)
  })

  it('should support React.lazy and dynamic imports', async () => {
    const html = await renderViaHTTP(context.appPort, '/dynamic-imports')
    expect(html).toContain('loading...')

    const browser = await webdriver(context.appPort, '/dynamic-imports')
    const content = await browser.eval(`window.document.body.innerText`)
    expect(content).toMatchInlineSnapshot('"foo.client"')
  })

  it('should have content-type and content-encoding headers', async () => {
    const res = await fetchViaHTTP(context.appPort, '/')
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(res.headers.get('content-encoding')).toBe('gzip')
  })

  basic(context, { env: 'dev' })
  streaming(context)
  rsc(context, { runtime: 'edge', env: 'dev' })
})

const nodejsRuntimeBasicSuite = {
  runTests: (context, env) => {
    basic(context, { env })
    streaming(context)
    rsc(context, { runtime: 'nodejs' })

    if (env === 'prod') {
      it('should generate middleware SSR manifests for Node.js', async () => {
        const distServerDir = join(distDir, 'server')

        const requiredServerFiles = (
          await fs.readJSON(join(distDir, 'required-server-files.json'))
        ).files

        const files = [
          'middleware-build-manifest.js',
          'middleware-flight-manifest.json',
          'middleware-manifest.json',
        ]

        files.forEach((file) => {
          const filepath = join(distServerDir, file)
          expect(fs.existsSync(filepath)).toBe(true)
        })

        requiredServerFiles.forEach((file) => {
          const requiredFilePath = join(appDir, file)
          expect(fs.existsSync(requiredFilePath)).toBe(true)
        })
      })
    }
  },
  beforeAll: () => {
    error500Page.write(page500)
    nextConfig.replace("runtime: 'edge'", "runtime: 'nodejs'")
  },
  afterAll: () => {
    error500Page.delete()
    nextConfig.restore()
  },
}

const customAppPageSuite = {
  runTests: (context) => {
    it('should render container in app', async () => {
      const indexHtml = await renderViaHTTP(context.appPort, '/')
      const indexFlight = await renderViaHTTP(context.appPort, '/?__flight__=1')
      expect(indexHtml).toContain('container-server')
      expect(indexFlight).toContain('container-server')
    })
  },
  beforeAll: () => appServerPage.write(rscAppPage),
  afterAll: () => appServerPage.delete(),
}

const cssSuite = {
  runTests: css,
  beforeAll: () => appPage.write(appWithGlobalCss),
  afterAll: () => appPage.delete(),
}

const documentSuite = {
  runTests: (context) => {
    it('should error when custom _document has getInitialProps method', async () => {
      const res = await fetchViaHTTP(context.appPort, '/')
      expect(res.status).toBe(500)
    })
  },
  beforeAll: () => documentPage.write(documentWithGip),
  afterAll: () => documentPage.delete(),
}

runSuite('Node.js runtime', 'dev', nodejsRuntimeBasicSuite)
runSuite('Node.js runtime', 'prod', nodejsRuntimeBasicSuite)

runSuite('Custom App', 'dev', customAppPageSuite)
runSuite('Custom App', 'prod', customAppPageSuite)

runSuite('CSS', 'dev', cssSuite)
runSuite('CSS', 'prod', cssSuite)

runSuite('Custom Document', 'dev', documentSuite)
runSuite('Custom Document', 'prod', documentSuite)

runSuite('Functions manifest', 'build', { runTests: functions })

function runSuite(suiteName, env, options) {
  const context = { appDir, distDir }
  describe(`${suiteName} ${env}`, () => {
    beforeAll(async () => {
      options.beforeAll?.()
      if (env === 'prod') {
        context.appPort = await findPort()
        await nextBuild(context.appDir)
        context.server = await nextStart(context.appDir, context.appPort)
      }
      if (env === 'dev') {
        context.appPort = await findPort()
        context.server = await nextDev(context.appDir, context.appPort)
      }
    })
    afterAll(async () => {
      options.afterAll?.()
      if (context.server) {
        await killApp(context.server)
      }
    })
    options.runTests(context, env)
  })
}
