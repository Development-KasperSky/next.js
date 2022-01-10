import glob from 'glob'
import fs from 'fs-extra'
import cheerio from 'cheerio'
import { join } from 'path'
import { createNext, FileRef } from 'e2e-utils'
import { NextInstance } from 'test/lib/next-modes/base'
import {
  check,
  fetchViaHTTP,
  findPort,
  initNextServerScript,
  killApp,
  renderViaHTTP,
} from 'next-test-utils'

describe('should set-up next', () => {
  let next: NextInstance
  let server
  let appPort
  let errors = []
  let requiredFilesManifest

  beforeAll(async () => {
    next = await createNext({
      files: {
        pages: new FileRef(join(__dirname, 'required-server-files/pages')),
        lib: new FileRef(join(__dirname, 'required-server-files/lib')),
        'data.txt': new FileRef(
          join(__dirname, 'required-server-files/data.txt')
        ),
      },
      nextConfig: {
        eslint: {
          ignoreDuringBuilds: true,
        },
        experimental: {
          outputStandalone: true,
        },
        async rewrites() {
          return [
            {
              source: '/some-catch-all/:path*',
              destination: '/',
            },
            {
              source: '/to-dynamic/:path',
              destination: '/dynamic/:path',
            },
          ]
        },
      },
    })
    await next.stop()

    requiredFilesManifest = JSON.parse(
      await next.readFile('.next/required-server-files.json')
    )
    await fs.move(
      join(next.testDir, '.next/standalone'),
      join(next.testDir, 'standalone')
    )
    for (const file of await fs.readdir(next.testDir)) {
      if (file !== 'standalone') {
        await fs.remove(join(next.testDir, file))
        console.log('removed', file)
      }
    }
    const files = glob.sync('**/*', {
      cwd: join(next.testDir, 'standalone/.next/server/pages'),
      dot: true,
    })

    for (const file of files) {
      if (file.endsWith('.json') || file.endsWith('.html')) {
        await fs.remove(join(next.testDir, '.next/server', file))
      }
    }

    const testServer = join(next.testDir, 'standalone/server.js')
    await fs.writeFile(
      testServer,
      (await fs.readFile(testServer, 'utf8'))
        .replace('console.error(err)', `console.error('top-level', err)`)
        .replace('conf:', 'minimalMode: true,conf:')
    )
    appPort = await findPort()
    server = await initNextServerScript(
      testServer,
      /Listening on/,
      {
        ...process.env,
        PORT: appPort,
      },
      undefined,
      {
        cwd: next.testDir,
        onStderr(msg) {
          if (msg.includes('top-level')) {
            errors.push(msg)
          }
        },
      }
    )
  })
  afterAll(async () => {
    await next.destroy()
    if (server) await killApp(server)
  })

  it('should output middleware correctly', async () => {
    expect(
      await fs.pathExists(
        join(next.testDir, 'standalone/.next/server/middleware-runtime.js')
      )
    ).toBe(true)
    expect(
      await fs.pathExists(
        join(
          next.testDir,
          'standalone/.next/server/pages/middleware/_middleware.js'
        )
      )
    ).toBe(true)
    expect(
      await fs.pathExists(
        join(next.testDir, 'standalone/.next/server/pages/_middleware.js')
      )
    ).toBe(true)
  })

  it('should output required-server-files manifest correctly', async () => {
    expect(requiredFilesManifest.version).toBe(1)
    expect(Array.isArray(requiredFilesManifest.files)).toBe(true)
    expect(Array.isArray(requiredFilesManifest.ignore)).toBe(true)
    expect(requiredFilesManifest.files.length).toBeGreaterThan(0)
    expect(requiredFilesManifest.ignore.length).toBeGreaterThan(0)
    expect(typeof requiredFilesManifest.config.configFile).toBe('undefined')
    expect(typeof requiredFilesManifest.config.trailingSlash).toBe('boolean')
    expect(typeof requiredFilesManifest.appDir).toBe('string')
  })

  it('should set correct SWR headers with notFound gsp', async () => {
    await next.patchFile('standalone/data.txt', 'show')

    const res = await fetchViaHTTP(appPort, '/gsp', undefined, {
      redirect: 'manual ',
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe(
      's-maxage=1, stale-while-revalidate'
    )

    await next.patchFile('standalone/data.txt', 'hide')

    const res2 = await fetchViaHTTP(appPort, '/gsp', undefined, {
      redirect: 'manual ',
    })
    expect(res2.status).toBe(404)
    expect(res2.headers.get('cache-control')).toBe(
      's-maxage=1, stale-while-revalidate'
    )
  })

  it('should set correct SWR headers with notFound gssp', async () => {
    await next.patchFile('standalone/data.txt', 'show')

    const res = await fetchViaHTTP(appPort, '/gssp', undefined, {
      redirect: 'manual ',
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe(
      's-maxage=1, stale-while-revalidate'
    )

    await next.patchFile('standalone/data.txt', 'hide')

    const res2 = await fetchViaHTTP(appPort, '/gssp', undefined, {
      redirect: 'manual ',
    })
    expect(res2.status).toBe(404)
    expect(res2.headers.get('cache-control')).toBe(
      's-maxage=1, stale-while-revalidate'
    )
  })

  it('should render SSR page correctly', async () => {
    const html = await renderViaHTTP(appPort, '/')
    const $ = cheerio.load(html)
    const data = JSON.parse($('#props').text())

    expect($('#index').text()).toBe('index page')
    expect(data.hello).toBe('world')

    const html2 = await renderViaHTTP(appPort, '/')
    const $2 = cheerio.load(html2)
    const data2 = JSON.parse($2('#props').text())

    expect($2('#index').text()).toBe('index page')
    expect(isNaN(data2.random)).toBe(false)
    expect(data2.random).not.toBe(data.random)
  })

  it('should render dynamic SSR page correctly', async () => {
    const html = await renderViaHTTP(appPort, '/dynamic/first')
    const $ = cheerio.load(html)
    const data = JSON.parse($('#props').text())

    expect($('#dynamic').text()).toBe('dynamic page')
    expect($('#slug').text()).toBe('first')
    expect(data.hello).toBe('world')

    const html2 = await renderViaHTTP(appPort, '/dynamic/second')
    const $2 = cheerio.load(html2)
    const data2 = JSON.parse($2('#props').text())

    expect($2('#dynamic').text()).toBe('dynamic page')
    expect($2('#slug').text()).toBe('second')
    expect(isNaN(data2.random)).toBe(false)
    expect(data2.random).not.toBe(data.random)
  })

  it('should render fallback page correctly', async () => {
    const html = await renderViaHTTP(appPort, '/fallback/first')
    const $ = cheerio.load(html)
    const data = JSON.parse($('#props').text())

    expect($('#fallback').text()).toBe('fallback page')
    expect($('#slug').text()).toBe('first')
    expect(data.hello).toBe('world')

    const html2 = await renderViaHTTP(appPort, '/fallback/first')
    const $2 = cheerio.load(html2)
    const data2 = JSON.parse($2('#props').text())

    expect($2('#fallback').text()).toBe('fallback page')
    expect($2('#slug').text()).toBe('first')
    expect(isNaN(data2.random)).toBe(false)
    expect(data2.random).not.toBe(data.random)

    const html3 = await renderViaHTTP(appPort, '/fallback/second')
    const $3 = cheerio.load(html3)
    const data3 = JSON.parse($3('#props').text())

    expect($3('#fallback').text()).toBe('fallback page')
    expect($3('#slug').text()).toBe('second')
    expect(isNaN(data3.random)).toBe(false)

    const { pageProps: data4 } = JSON.parse(
      await renderViaHTTP(
        appPort,
        `/_next/data/${next.buildId}/fallback/third.json`
      )
    )
    expect(data4.hello).toBe('world')
    expect(data4.slug).toBe('third')
  })

  it('should render SSR page correctly with x-matched-path', async () => {
    const html = await renderViaHTTP(appPort, '/some-other-path', undefined, {
      headers: {
        'x-matched-path': '/',
      },
    })
    const $ = cheerio.load(html)
    const data = JSON.parse($('#props').text())

    expect($('#index').text()).toBe('index page')
    expect(data.hello).toBe('world')

    const html2 = await renderViaHTTP(appPort, '/some-other-path', undefined, {
      headers: {
        'x-matched-path': '/',
      },
    })
    const $2 = cheerio.load(html2)
    const data2 = JSON.parse($2('#props').text())

    expect($2('#index').text()).toBe('index page')
    expect(isNaN(data2.random)).toBe(false)
    expect(data2.random).not.toBe(data.random)
  })

  it('should render dynamic SSR page correctly with x-matched-path', async () => {
    const html = await renderViaHTTP(appPort, '/some-other-path', undefined, {
      headers: {
        'x-matched-path': '/dynamic/[slug]?slug=first',
      },
    })
    const $ = cheerio.load(html)
    const data = JSON.parse($('#props').text())

    expect($('#dynamic').text()).toBe('dynamic page')
    expect($('#slug').text()).toBe('first')
    expect(data.hello).toBe('world')

    const html2 = await renderViaHTTP(appPort, '/some-other-path', undefined, {
      headers: {
        'x-matched-path': '/dynamic/[slug]?slug=second',
      },
    })
    const $2 = cheerio.load(html2)
    const data2 = JSON.parse($2('#props').text())

    expect($2('#dynamic').text()).toBe('dynamic page')
    expect($2('#slug').text()).toBe('second')
    expect(isNaN(data2.random)).toBe(false)
    expect(data2.random).not.toBe(data.random)

    const html3 = await renderViaHTTP(appPort, '/some-other-path', undefined, {
      headers: {
        'x-matched-path': '/dynamic/[slug]?slug=%5Bslug%5D.json',
        'x-now-route-matches': '1=second&slug=second',
      },
    })
    const $3 = cheerio.load(html3)
    const data3 = JSON.parse($3('#props').text())

    expect($3('#dynamic').text()).toBe('dynamic page')
    expect($3('#slug').text()).toBe('second')
    expect(isNaN(data3.random)).toBe(false)
    expect(data3.random).not.toBe(data.random)
  })

  it('should render fallback page correctly with x-matched-path and routes-matches', async () => {
    const html = await renderViaHTTP(appPort, '/fallback/first', undefined, {
      headers: {
        'x-matched-path': '/fallback/first',
        'x-now-route-matches': '1=first',
      },
    })
    const $ = cheerio.load(html)
    const data = JSON.parse($('#props').text())

    expect($('#fallback').text()).toBe('fallback page')
    expect($('#slug').text()).toBe('first')
    expect(data.hello).toBe('world')

    const html2 = await renderViaHTTP(appPort, `/fallback/[slug]`, undefined, {
      headers: {
        'x-matched-path': '/fallback/[slug]',
        'x-now-route-matches': '1=second',
      },
    })
    const $2 = cheerio.load(html2)
    const data2 = JSON.parse($2('#props').text())

    expect($2('#fallback').text()).toBe('fallback page')
    expect($2('#slug').text()).toBe('second')
    expect(isNaN(data2.random)).toBe(false)
    expect(data2.random).not.toBe(data.random)
  })

  it('should return data correctly with x-matched-path', async () => {
    const res = await fetchViaHTTP(
      appPort,
      `/_next/data/${next.buildId}/dynamic/first.json`,
      undefined,
      {
        headers: {
          'x-matched-path': '/dynamic/[slug]?slug=first',
        },
      }
    )

    const { pageProps: data } = await res.json()

    expect(data.slug).toBe('first')
    expect(data.hello).toBe('world')

    const res2 = await fetchViaHTTP(
      appPort,
      `/_next/data/${next.buildId}/fallback/[slug].json`,
      undefined,
      {
        headers: {
          'x-matched-path': `/_next/data/${next.buildId}/fallback/[slug].json`,
          'x-now-route-matches': '1=second',
        },
      }
    )

    const { pageProps: data2 } = await res2.json()

    expect(data2.slug).toBe('second')
    expect(data2.hello).toBe('world')
  })

  it('should render fallback optional catch-all route correctly with x-matched-path and routes-matches', async () => {
    const html = await renderViaHTTP(
      appPort,
      '/catch-all/[[...rest]]',
      undefined,
      {
        headers: {
          'x-matched-path': '/catch-all/[[...rest]]',
          'x-now-route-matches': '',
        },
      }
    )
    const $ = cheerio.load(html)
    const data = JSON.parse($('#props').text())

    expect($('#catch-all').text()).toBe('optional catch-all page')
    expect(data.params).toEqual({})
    expect(data.hello).toBe('world')

    const html2 = await renderViaHTTP(
      appPort,
      '/catch-all/[[...rest]]',
      undefined,
      {
        headers: {
          'x-matched-path': '/catch-all/[[...rest]]',
          'x-now-route-matches': '1=hello&catchAll=hello',
        },
      }
    )
    const $2 = cheerio.load(html2)
    const data2 = JSON.parse($2('#props').text())

    expect($2('#catch-all').text()).toBe('optional catch-all page')
    expect(data2.params).toEqual({ rest: ['hello'] })
    expect(isNaN(data2.random)).toBe(false)
    expect(data2.random).not.toBe(data.random)

    const html3 = await renderViaHTTP(
      appPort,
      '/catch-all/[[..rest]]',
      undefined,
      {
        headers: {
          'x-matched-path': '/catch-all/[[...rest]]',
          'x-now-route-matches': '1=hello/world&catchAll=hello/world',
        },
      }
    )
    const $3 = cheerio.load(html3)
    const data3 = JSON.parse($3('#props').text())

    expect($3('#catch-all').text()).toBe('optional catch-all page')
    expect(data3.params).toEqual({ rest: ['hello', 'world'] })
    expect(isNaN(data3.random)).toBe(false)
    expect(data3.random).not.toBe(data.random)
  })

  it('should return data correctly with x-matched-path for optional catch-all route', async () => {
    const res = await fetchViaHTTP(
      appPort,
      `/_next/data/${next.buildId}/catch-all.json`,
      undefined,
      {
        headers: {
          'x-matched-path': '/catch-all/[[...rest]]',
        },
      }
    )

    const { pageProps: data } = await res.json()

    expect(data.params).toEqual({})
    expect(data.hello).toBe('world')

    const res2 = await fetchViaHTTP(
      appPort,
      `/_next/data/${next.buildId}/catch-all/[[...rest]].json`,
      undefined,
      {
        headers: {
          'x-matched-path': `/_next/data/${next.buildId}/catch-all/[[...rest]].json`,
          'x-now-route-matches': '1=hello&rest=hello',
        },
      }
    )

    const { pageProps: data2 } = await res2.json()

    expect(data2.params).toEqual({ rest: ['hello'] })
    expect(data2.hello).toBe('world')

    const res3 = await fetchViaHTTP(
      appPort,
      `/_next/data/${next.buildId}/catch-all/[[...rest]].json`,
      undefined,
      {
        headers: {
          'x-matched-path': `/_next/data/${next.buildId}/catch-all/[[...rest]].json`,
          'x-now-route-matches': '1=hello/world&rest=hello/world',
        },
      }
    )

    const { pageProps: data3 } = await res3.json()

    expect(data3.params).toEqual({ rest: ['hello', 'world'] })
    expect(data3.hello).toBe('world')
  })

  it('should not apply trailingSlash redirect', async () => {
    for (const path of [
      '/',
      '/dynamic/another/',
      '/dynamic/another',
      '/fallback/first/',
      '/fallback/first',
      '/fallback/another/',
      '/fallback/another',
    ]) {
      const res = await fetchViaHTTP(appPort, path, undefined, {
        redirect: 'manual',
      })

      expect(res.status).toBe(200)
    }
  })

  it('should normalize catch-all rewrite query values correctly', async () => {
    const html = await renderViaHTTP(
      appPort,
      '/some-catch-all/hello/world',
      {
        path: 'hello/world',
      },
      {
        headers: {
          'x-matched-path': '/',
        },
      }
    )
    const $ = cheerio.load(html)
    expect(JSON.parse($('#router').text()).query).toEqual({
      path: ['hello', 'world'],
    })
  })

  it('should handle bad request correctly with rewrite', async () => {
    const res = await fetchViaHTTP(
      appPort,
      '/to-dynamic/%c0.%c0.',
      '?path=%c0.%c0.',
      {
        headers: {
          'x-matched-path': '/dynamic/[slug]',
        },
      }
    )
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('Bad Request')
  })

  it('should bubble error correctly for gip page', async () => {
    errors = []
    const res = await fetchViaHTTP(appPort, '/errors/gip', { crash: '1' })
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('internal server error')

    await check(
      () => (errors[0].includes('gip hit an oops') ? 'success' : errors[0]),
      'success'
    )
  })

  it('should bubble error correctly for gssp page', async () => {
    errors = []
    const res = await fetchViaHTTP(appPort, '/errors/gssp', { crash: '1' })
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('internal server error')
    await check(
      () => (errors[0].includes('gssp hit an oops') ? 'success' : errors[0]),
      'success'
    )
  })

  it('should bubble error correctly for gsp page', async () => {
    errors = []
    const res = await fetchViaHTTP(appPort, '/errors/gsp/crash')
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('internal server error')
    await check(
      () => (errors[0].includes('gsp hit an oops') ? 'success' : errors[0]),
      'success'
    )
  })

  it('should bubble error correctly for API page', async () => {
    errors = []
    const res = await fetchViaHTTP(appPort, '/api/error')
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('internal server error')
    await check(
      () =>
        errors[0].includes('some error from /api/error')
          ? 'success'
          : errors[0],
      'success'
    )
  })

  it('should normalize optional values correctly for SSP page', async () => {
    const res = await fetchViaHTTP(
      appPort,
      '/optional-ssp',
      { rest: '', another: 'value' },
      {
        headers: {
          'x-matched-path': '/optional-ssp/[[...rest]]',
        },
      }
    )

    const html = await res.text()
    const $ = cheerio.load(html)
    const props = JSON.parse($('#props').text())
    expect(props.params).toEqual({})
    expect(props.query).toEqual({ another: 'value' })
  })

  it('should normalize optional values correctly for SSG page', async () => {
    const res = await fetchViaHTTP(
      appPort,
      '/optional-ssg',
      { rest: '', another: 'value' },
      {
        headers: {
          'x-matched-path': '/optional-ssg/[[...rest]]',
        },
      }
    )

    const html = await res.text()
    const $ = cheerio.load(html)
    const props = JSON.parse($('#props').text())
    expect(props.params).toEqual({})
  })

  it('should normalize optional values correctly for SSG page with encoded slash', async () => {
    const res = await fetchViaHTTP(
      appPort,
      '/optional-ssg/[[...rest]]',
      undefined,
      {
        headers: {
          'x-matched-path': '/optional-ssg/[[...rest]]',
          'x-now-route-matches':
            '1=en%2Fes%2Fhello%252Fworld&rest=en%2Fes%2Fhello%252Fworld',
        },
      }
    )

    const html = await res.text()
    const $ = cheerio.load(html)
    const props = JSON.parse($('#props').text())
    expect(props.params).toEqual({
      rest: ['en', 'es', 'hello/world'],
    })
  })

  it('should normalize optional values correctly for API page', async () => {
    const res = await fetchViaHTTP(
      appPort,
      '/api/optional',
      { rest: '', another: 'value' },
      {
        headers: {
          'x-matched-path': '/api/optional/[[...rest]]',
        },
      }
    )

    const json = await res.json()
    expect(json.query).toEqual({ another: 'value' })
    expect(json.url).toBe('/api/optional?another=value')
  })

  it('should match the index page correctly', async () => {
    const res = await fetchViaHTTP(appPort, '/', undefined, {
      headers: {
        'x-matched-path': '/index',
      },
      redirect: 'manual',
    })

    const html = await res.text()
    const $ = cheerio.load(html)
    expect($('#index').text()).toBe('index page')
  })

  it('should match the root dyanmic page correctly', async () => {
    const res = await fetchViaHTTP(appPort, '/index', undefined, {
      headers: {
        'x-matched-path': '/[slug]',
      },
      redirect: 'manual',
    })

    const html = await res.text()
    const $ = cheerio.load(html)
    expect($('#slug-page').text()).toBe('[slug] page')
  })
})
