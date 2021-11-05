import cheerio from 'cheerio'
import { join, sep } from 'path'
import escapeRegex from 'escape-string-regexp'
import { createNext, FileRef } from 'e2e-utils'
import { NextInstance } from 'test/lib/next-modes/base'
import {
  check,
  fetchViaHTTP,
  getBrowserBodyText,
  getRedboxHeader,
  hasRedbox,
  normalizeRegEx,
  renderViaHTTP,
  waitFor,
} from 'next-test-utils'
import webdriver from 'next-webdriver'

describe('Prerender', () => {
  let next: NextInstance

  beforeAll(async () => {
    next = await createNext({
      files: {
        pages: new FileRef(join(__dirname, 'prerender/pages')),
        'world.txt': new FileRef(join(__dirname, 'prerender/world.txt')),
      },
      dependencies: {
        firebase: '7.14.5',
      },
      nextConfig: {
        async rewrites() {
          return [
            {
              source: '/some-rewrite/:item',
              destination: '/blog/post-:item',
            },
            {
              source: '/about',
              destination: '/lang/en/about',
            },
            {
              source: '/blocked-create',
              destination: '/blocking-fallback/blocked-create',
            },
          ]
        },
      },
    })
  })
  afterAll(() => next.destroy())

  function isCachingHeader(cacheControl) {
    return !cacheControl || !/no-store/.test(cacheControl)
  }

  const expectedManifestRoutes = () => ({
    '/': {
      dataRoute: `/_next/data/${next.buildId}/index.json`,
      initialRevalidateSeconds: 2,
      srcRoute: null,
    },
    '/blog/[post3]': {
      dataRoute: `/_next/data/${next.buildId}/blog/[post3].json`,
      initialRevalidateSeconds: 10,
      srcRoute: '/blog/[post]',
    },
    '/blog/post-1': {
      dataRoute: `/_next/data/${next.buildId}/blog/post-1.json`,
      initialRevalidateSeconds: 10,
      srcRoute: '/blog/[post]',
    },
    '/blog/post-2': {
      dataRoute: `/_next/data/${next.buildId}/blog/post-2.json`,
      initialRevalidateSeconds: 10,
      srcRoute: '/blog/[post]',
    },
    '/blog/post-4': {
      dataRoute: `/_next/data/${next.buildId}/blog/post-4.json`,
      initialRevalidateSeconds: 10,
      srcRoute: '/blog/[post]',
    },
    '/blog/post-1/comment-1': {
      dataRoute: `/_next/data/${next.buildId}/blog/post-1/comment-1.json`,
      initialRevalidateSeconds: 2,
      srcRoute: '/blog/[post]/[comment]',
    },
    '/blog/post-2/comment-2': {
      dataRoute: `/_next/data/${next.buildId}/blog/post-2/comment-2.json`,
      initialRevalidateSeconds: 2,
      srcRoute: '/blog/[post]/[comment]',
    },
    '/blog/post.1': {
      dataRoute: `/_next/data/${next.buildId}/blog/post.1.json`,
      initialRevalidateSeconds: 10,
      srcRoute: '/blog/[post]',
    },
    '/catchall-explicit/another/value': {
      dataRoute: `/_next/data/${next.buildId}/catchall-explicit/another/value.json`,
      initialRevalidateSeconds: 1,
      srcRoute: '/catchall-explicit/[...slug]',
    },
    '/catchall-explicit/first': {
      dataRoute: `/_next/data/${next.buildId}/catchall-explicit/first.json`,
      initialRevalidateSeconds: 1,
      srcRoute: '/catchall-explicit/[...slug]',
    },
    '/catchall-explicit/hello/another': {
      dataRoute: `/_next/data/${next.buildId}/catchall-explicit/hello/another.json`,
      initialRevalidateSeconds: 1,
      srcRoute: '/catchall-explicit/[...slug]',
    },
    '/catchall-explicit/second': {
      dataRoute: `/_next/data/${next.buildId}/catchall-explicit/second.json`,
      initialRevalidateSeconds: 1,
      srcRoute: '/catchall-explicit/[...slug]',
    },
    '/catchall-explicit/[first]/[second]': {
      dataRoute: `/_next/data/${next.buildId}/catchall-explicit/[first]/[second].json`,
      initialRevalidateSeconds: 1,
      srcRoute: '/catchall-explicit/[...slug]',
    },
    '/catchall-explicit/[third]/[fourth]': {
      dataRoute: `/_next/data/${next.buildId}/catchall-explicit/[third]/[fourth].json`,
      initialRevalidateSeconds: 1,
      srcRoute: '/catchall-explicit/[...slug]',
    },
    '/catchall-optional': {
      dataRoute: `/_next/data/${next.buildId}/catchall-optional.json`,
      initialRevalidateSeconds: false,
      srcRoute: '/catchall-optional/[[...slug]]',
    },
    '/catchall-optional/value': {
      dataRoute: `/_next/data/${next.buildId}/catchall-optional/value.json`,
      initialRevalidateSeconds: false,
      srcRoute: '/catchall-optional/[[...slug]]',
    },
    '/large-page-data': {
      dataRoute: `/_next/data/${next.buildId}/large-page-data.json`,
      initialRevalidateSeconds: false,
      srcRoute: null,
    },
    '/another': {
      dataRoute: `/_next/data/${next.buildId}/another.json`,
      initialRevalidateSeconds: 1,
      srcRoute: null,
    },
    '/api-docs/first': {
      dataRoute: `/_next/data/${next.buildId}/api-docs/first.json`,
      initialRevalidateSeconds: false,
      srcRoute: '/api-docs/[...slug]',
    },
    '/blocking-fallback-some/a': {
      dataRoute: `/_next/data/${next.buildId}/blocking-fallback-some/a.json`,
      initialRevalidateSeconds: 1,
      srcRoute: '/blocking-fallback-some/[slug]',
    },
    '/blocking-fallback-some/b': {
      dataRoute: `/_next/data/${next.buildId}/blocking-fallback-some/b.json`,
      initialRevalidateSeconds: 1,
      srcRoute: '/blocking-fallback-some/[slug]',
    },
    '/blog': {
      dataRoute: `/_next/data/${next.buildId}/blog.json`,
      initialRevalidateSeconds: 10,
      srcRoute: null,
    },
    '/default-revalidate': {
      dataRoute: `/_next/data/${next.buildId}/default-revalidate.json`,
      initialRevalidateSeconds: false,
      srcRoute: null,
    },
    '/dynamic/[first]': {
      dataRoute: `/_next/data/${next.buildId}/dynamic/[first].json`,
      initialRevalidateSeconds: false,
      srcRoute: '/dynamic/[slug]',
    },
    '/dynamic/[second]': {
      dataRoute: `/_next/data/${next.buildId}/dynamic/[second].json`,
      initialRevalidateSeconds: false,
      srcRoute: '/dynamic/[slug]',
    },
    '/index': {
      dataRoute: `/_next/data/${next.buildId}/index/index.json`,
      initialRevalidateSeconds: false,
      srcRoute: null,
    },
    '/lang/de/about': {
      dataRoute: `/_next/data/${next.buildId}/lang/de/about.json`,
      initialRevalidateSeconds: false,
      srcRoute: '/lang/[lang]/about',
    },
    '/lang/en/about': {
      dataRoute: `/_next/data/${next.buildId}/lang/en/about.json`,
      initialRevalidateSeconds: false,
      srcRoute: '/lang/[lang]/about',
    },
    '/lang/es/about': {
      dataRoute: `/_next/data/${next.buildId}/lang/es/about.json`,
      initialRevalidateSeconds: false,
      srcRoute: '/lang/[lang]/about',
    },
    '/lang/fr/about': {
      dataRoute: `/_next/data/${next.buildId}/lang/fr/about.json`,
      initialRevalidateSeconds: false,
      srcRoute: '/lang/[lang]/about',
    },
    '/something': {
      dataRoute: `/_next/data/${next.buildId}/something.json`,
      initialRevalidateSeconds: false,
      srcRoute: null,
    },
    '/catchall/another/value': {
      dataRoute: `/_next/data/${next.buildId}/catchall/another/value.json`,
      initialRevalidateSeconds: 1,
      srcRoute: '/catchall/[...slug]',
    },
    '/catchall/first': {
      dataRoute: `/_next/data/${next.buildId}/catchall/first.json`,
      initialRevalidateSeconds: 1,
      srcRoute: '/catchall/[...slug]',
    },
    '/catchall/second': {
      dataRoute: `/_next/data/${next.buildId}/catchall/second.json`,
      initialRevalidateSeconds: 1,
      srcRoute: '/catchall/[...slug]',
    },
    '/catchall/hello/another': {
      dataRoute: `/_next/data/${next.buildId}/catchall/hello/another.json`,
      initialRevalidateSeconds: 1,
      srcRoute: '/catchall/[...slug]',
    },
  })

  const navigateTest = (dev = false) => {
    it('should navigate between pages successfully', async () => {
      const toBuild = [
        '/',
        '/another',
        '/something',
        '/normal',
        '/blog/post-1',
        '/blog/post-1/comment-1',
        '/catchall/first',
      ]

      await waitFor(2500)

      await Promise.all(toBuild.map((pg) => renderViaHTTP(next.url, pg)))

      const browser = await webdriver(next.url, '/')
      let text = await browser.elementByCss('p').text()
      expect(text).toMatch(/hello.*?world/)

      // go to /another
      async function goFromHomeToAnother() {
        await browser.eval('window.beforeAnother = true')
        await browser.elementByCss('#another').click()
        await browser.waitForElementByCss('#home')
        text = await browser.elementByCss('p').text()
        expect(await browser.eval('window.beforeAnother')).toBe(true)
        expect(text).toMatch(/hello.*?world/)
      }
      await goFromHomeToAnother()

      // go to /
      async function goFromAnotherToHome() {
        await browser.eval('window.didTransition = 1')
        await browser.elementByCss('#home').click()
        await browser.waitForElementByCss('#another')
        text = await browser.elementByCss('p').text()
        expect(text).toMatch(/hello.*?world/)
        expect(await browser.eval('window.didTransition')).toBe(1)
      }
      await goFromAnotherToHome()

      // Client-side SSG data caching test
      // eslint-disable-next-line no-lone-blocks
      {
        // Let revalidation period lapse
        await waitFor(2000)

        // Trigger revalidation (visit page)
        await goFromHomeToAnother()
        const snapTime = await browser.elementByCss('#anotherTime').text()

        // Wait for revalidation to finish
        await waitFor(2000)

        // Re-visit page
        await goFromAnotherToHome()
        await goFromHomeToAnother()

        const nextTime = await browser.elementByCss('#anotherTime').text()
        if (dev) {
          expect(snapTime).not.toMatch(nextTime)
        } else {
          expect(snapTime).toMatch(nextTime)
        }

        // Reset to Home for next test
        await goFromAnotherToHome()
      }

      // go to /something
      await browser.elementByCss('#something').click()
      await browser.waitForElementByCss('#home')
      text = await browser.elementByCss('p').text()
      expect(text).toMatch(/hello.*?world/)
      expect(await browser.eval('window.didTransition')).toBe(1)

      // go to /
      await browser.elementByCss('#home').click()
      await browser.waitForElementByCss('#post-1')

      // go to /blog/post-1
      await browser.elementByCss('#post-1').click()
      await browser.waitForElementByCss('#home')
      text = await browser.elementByCss('p').text()
      expect(text).toMatch(/Post:.*?post-1/)
      expect(await browser.eval('window.didTransition')).toBe(1)

      // go to /
      await browser.elementByCss('#home').click()
      await browser.waitForElementByCss('#comment-1')

      // go to /index
      await browser.elementByCss('#to-nested-index').click()
      await browser.waitForElementByCss('#home')
      text = await browser.elementByCss('p').text()
      expect(text).toMatch(/hello nested index/)

      // go to /
      await browser.elementByCss('#home').click()
      await browser.waitForElementByCss('#comment-1')

      // go to /catchall-optional
      await browser.elementByCss('#catchall-optional-root').click()
      await browser.waitForElementByCss('#home')
      text = await browser.elementByCss('p').text()
      expect(text).toMatch(/Catch all: \[\]/)
      expect(await browser.eval('window.didTransition')).toBe(1)

      // go to /
      await browser.elementByCss('#home').click()
      await browser.waitForElementByCss('#comment-1')

      // go to /dynamic/[first]
      await browser.elementByCss('#dynamic-first').click()
      await browser.waitForElementByCss('#home')
      text = await browser.elementByCss('#param').text()
      expect(text).toMatch(/Hi \[first\]!/)
      expect(await browser.eval('window.didTransition')).toBe(1)

      // go to /
      await browser.elementByCss('#home').click()
      await browser.waitForElementByCss('#comment-1')

      // go to /dynamic/[second]
      await browser.elementByCss('#dynamic-second').click()
      await browser.waitForElementByCss('#home')
      text = await browser.elementByCss('#param').text()
      expect(text).toMatch(/Hi \[second\]!/)
      expect(await browser.eval('window.didTransition')).toBe(1)

      // go to /
      await browser.elementByCss('#home').click()
      await browser.waitForElementByCss('#comment-1')

      // go to /catchall-explicit/[first]/[second]
      await browser.elementByCss('#catchall-explicit-string').click()
      await browser.waitForElementByCss('#home')
      text = await browser.elementByCss('#catchall').text()
      expect(text).toMatch(/Hi \[first\] \[second\]/)
      expect(await browser.eval('window.didTransition')).toBe(1)

      // go to /
      await browser.elementByCss('#home').click()
      await browser.waitForElementByCss('#comment-1')

      // go to /catchall-explicit/[first]/[second]
      await browser.elementByCss('#catchall-explicit-object').click()
      await browser.waitForElementByCss('#home')
      text = await browser.elementByCss('#catchall').text()
      expect(text).toMatch(/Hi \[third\] \[fourth\]/)
      expect(await browser.eval('window.didTransition')).toBe(1)

      // go to /
      await browser.elementByCss('#home').click()
      await browser.waitForElementByCss('#comment-1')

      // go to /catchall-optional/value
      await browser.elementByCss('#catchall-optional-value').click()
      await browser.waitForElementByCss('#home')
      text = await browser.elementByCss('p').text()
      expect(text).toMatch(/Catch all: \[value\]/)
      expect(await browser.eval('window.didTransition')).toBe(1)

      // go to /
      await browser.elementByCss('#home').click()
      await browser.waitForElementByCss('#comment-1')

      // go to /blog/post-1/comment-1
      await browser.elementByCss('#comment-1').click()
      await browser.waitForElementByCss('#home')
      text = await browser.elementByCss('p:nth-child(2)').text()
      expect(text).toMatch(/Comment:.*?comment-1/)
      expect(await browser.eval('window.didTransition')).toBe(1)

      // go to /catchall/first
      await browser.elementByCss('#home').click()
      await browser.waitForElementByCss('#to-catchall')
      await browser.elementByCss('#to-catchall').click()
      await browser.waitForElementByCss('#catchall')
      text = await browser.elementByCss('#catchall').text()
      expect(text).toMatch(/Hi.*?first/)
      expect(await browser.eval('window.didTransition')).toBe(1)

      await browser.close()
    })
  }

  const runTests = (dev = false) => {
    navigateTest(dev)

    it('should SSR normal page correctly', async () => {
      const html = await renderViaHTTP(next.url, '/')
      expect(html).toMatch(/hello.*?world/)
    })

    it('should SSR incremental page correctly', async () => {
      const html = await renderViaHTTP(next.url, '/blog/post-1')

      const $ = cheerio.load(html)
      expect(JSON.parse($('#__NEXT_DATA__').text()).isFallback).toBe(false)
      expect(html).toMatch(/Post:.*?post-1/)
    })

    it('should SSR blocking path correctly (blocking)', async () => {
      const html = await renderViaHTTP(
        next.url,
        '/blocking-fallback/random-path'
      )
      const $ = cheerio.load(html)
      expect(JSON.parse($('#__NEXT_DATA__').text()).isFallback).toBe(false)
      expect($('p').text()).toBe('Post: random-path')
    })

    it('should SSR blocking path correctly (pre-rendered)', async () => {
      const html = await renderViaHTTP(next.url, '/blocking-fallback-some/a')
      const $ = cheerio.load(html)
      expect(JSON.parse($('#__NEXT_DATA__').text()).isFallback).toBe(false)
      expect($('p').text()).toBe('Post: a')
    })

    it('should have gsp in __NEXT_DATA__', async () => {
      const html = await renderViaHTTP(next.url, '/')
      const $ = cheerio.load(html)
      expect(JSON.parse($('#__NEXT_DATA__').text()).gsp).toBe(true)
    })

    it('should not have gsp in __NEXT_DATA__ for non-GSP page', async () => {
      const html = await renderViaHTTP(next.url, '/normal')
      const $ = cheerio.load(html)
      expect('gsp' in JSON.parse($('#__NEXT_DATA__').text())).toBe(false)
    })

    it('should not supply query values to params or useRouter non-dynamic page SSR', async () => {
      const html = await renderViaHTTP(next.url, '/something?hello=world')
      const $ = cheerio.load(html)
      const query = $('#query').text()
      expect(JSON.parse(query)).toEqual({})
      const params = $('#params').text()
      expect(JSON.parse(params)).toEqual({})
    })

    it('should not supply query values to params in /_next/data request', async () => {
      const data = JSON.parse(
        await renderViaHTTP(
          next.url,
          `/_next/data/${next.buildId}/something.json?hello=world`
        )
      )
      expect(data.pageProps.params).toEqual({})
    })

    it('should not supply query values to params or useRouter dynamic page SSR', async () => {
      const html = await renderViaHTTP(next.url, '/blog/post-1?hello=world')
      const $ = cheerio.load(html)

      const params = $('#params').text()
      expect(JSON.parse(params)).toEqual({ post: 'post-1' })

      const query = $('#query').text()
      expect(JSON.parse(query)).toEqual({ post: 'post-1' })
    })

    it('should return data correctly', async () => {
      const data = JSON.parse(
        await renderViaHTTP(
          next.url,
          expectedManifestRoutes()['/something'].dataRoute
        )
      )
      expect(data.pageProps.world).toBe('world')
    })

    it('should return data correctly for dynamic page', async () => {
      const data = JSON.parse(
        await renderViaHTTP(
          next.url,
          expectedManifestRoutes()['/blog/post-1'].dataRoute
        )
      )
      expect(data.pageProps.post).toBe('post-1')
    })

    it('should return data correctly for dynamic page (non-seeded)', async () => {
      const data = JSON.parse(
        await renderViaHTTP(
          next.url,
          expectedManifestRoutes()['/blog/post-1'].dataRoute.replace(
            /post-1/,
            'post-3'
          )
        )
      )
      expect(data.pageProps.post).toBe('post-3')
    })

    if (!dev) {
      it('should use correct caching headers for a revalidate page', async () => {
        const initialRes = await fetchViaHTTP(next.url, '/')
        expect(initialRes.headers.get('cache-control')).toBe(
          's-maxage=2, stale-while-revalidate'
        )
      })
    }

    it('should navigate to a normal page and back', async () => {
      const browser = await webdriver(next.url, '/')
      let text = await browser.elementByCss('p').text()
      expect(text).toMatch(/hello.*?world/)

      await browser.elementByCss('#normal').click()
      await browser.waitForElementByCss('#normal-text')
      text = await browser.elementByCss('#normal-text').text()
      expect(text).toMatch(/a normal page/)
    })

    it('should parse query values on mount correctly', async () => {
      const browser = await webdriver(next.url, '/blog/post-1?another=value')
      const text = await browser.elementByCss('#query').text()
      expect(text).toMatch(/another.*?value/)
      expect(text).toMatch(/post.*?post-1/)
    })

    it('should reload page on failed data request', async () => {
      const browser = await webdriver(next.url, '/')
      await browser.eval('window.beforeClick = "abc"')
      await browser.elementByCss('#broken-post').click()
      expect(
        await check(() => browser.eval('window.beforeClick'), {
          test(v) {
            return v !== 'abc'
          },
        })
      ).toBe(true)
    })

    it('should SSR dynamic page with brackets in param as object', async () => {
      const html = await renderViaHTTP(next.url, '/dynamic/[first]')
      const $ = cheerio.load(html)
      expect($('#param').text()).toMatch(/Hi \[first\]!/)
    })

    it('should navigate to dynamic page with brackets in param as object', async () => {
      const browser = await webdriver(next.url, '/')
      await browser.elementByCss('#dynamic-first').click()
      await browser.waitForElementByCss('#param')
      const value = await browser.elementByCss('#param').text()
      expect(value).toMatch(/Hi \[first\]!/)
    })

    it('should SSR dynamic page with brackets in param as string', async () => {
      const html = await renderViaHTTP(next.url, '/dynamic/[second]')
      const $ = cheerio.load(html)
      expect($('#param').text()).toMatch(/Hi \[second\]!/)
    })

    it('should navigate to dynamic page with brackets in param as string', async () => {
      const browser = await webdriver(next.url, '/')
      await browser.elementByCss('#dynamic-second').click()
      await browser.waitForElementByCss('#param')
      const value = await browser.elementByCss('#param').text()
      expect(value).toMatch(/Hi \[second\]!/)
    })

    it('should not return data for fallback: false and missing dynamic page', async () => {
      const res1 = await fetchViaHTTP(
        next.url,
        `/_next/data/${next.buildId}/dynamic/oopsie.json`
      )
      expect(res1.status).toBe(404)

      await waitFor(500)

      const res2 = await fetchViaHTTP(
        next.url,
        `/_next/data/${next.buildId}/dynamic/oopsie.json`
      )
      expect(res2.status).toBe(404)

      await waitFor(500)

      const res3 = await fetchViaHTTP(
        next.url,
        `/_next/data/${next.buildId}/dynamic/oopsie.json`
      )
      expect(res3.status).toBe(404)
    })

    it('should server prerendered path correctly for SSG pages that starts with api-docs', async () => {
      const html = await renderViaHTTP(next.url, '/api-docs/first')
      const $ = cheerio.load(html)

      expect($('#api-docs').text()).toBe('API Docs')
      expect(JSON.parse($('#props').text())).toEqual({
        hello: 'world',
      })
    })

    it('should render correctly for SSG pages that starts with api-docs', async () => {
      const browser = await webdriver(next.url, '/api-docs/second')
      await browser.waitForElementByCss('#api-docs')

      expect(await browser.elementByCss('#api-docs').text()).toBe('API Docs')
      expect(JSON.parse(await browser.elementByCss('#props').text())).toEqual({
        hello: 'world',
      })
    })

    it('should return data correctly for SSG pages that starts with api-docs', async () => {
      const data = await renderViaHTTP(
        next.url,
        `/_next/data/${next.buildId}/api-docs/first.json`
      )
      const { pageProps } = JSON.parse(data)

      expect(pageProps).toEqual({
        hello: 'world',
      })
    })

    it('should SSR catch-all page with brackets in param as string', async () => {
      const html = await renderViaHTTP(
        next.url,
        '/catchall-explicit/[first]/[second]'
      )
      const $ = cheerio.load(html)
      expect($('#catchall').text()).toMatch(/Hi \[first\] \[second\]/)
    })

    it('should navigate to catch-all page with brackets in param as string', async () => {
      const browser = await webdriver(next.url, '/')
      await browser.elementByCss('#catchall-explicit-string').click()
      await browser.waitForElementByCss('#catchall')
      const value = await browser.elementByCss('#catchall').text()
      expect(value).toMatch(/Hi \[first\] \[second\]/)
    })

    it('should SSR catch-all page with brackets in param as object', async () => {
      const html = await renderViaHTTP(
        next.url,
        '/catchall-explicit/[third]/[fourth]'
      )
      const $ = cheerio.load(html)
      expect($('#catchall').text()).toMatch(/Hi \[third\] \[fourth\]/)
    })

    it('should navigate to catch-all page with brackets in param as object', async () => {
      const browser = await webdriver(next.url, '/')
      await browser.elementByCss('#catchall-explicit-object').click()
      await browser.waitForElementByCss('#catchall')
      const value = await browser.elementByCss('#catchall').text()
      expect(value).toMatch(/Hi \[third\] \[fourth\]/)
    })

    if ((global as any).isNextStart) {
      // TODO: dev currently renders this page as blocking, meaning it shows the
      // server error instead of continuously retrying. Do we want to change this?
      it.skip('should reload page on failed data request, and retry', async () => {
        const browser = await webdriver(next.url, '/')
        await browser.eval('window.beforeClick = "abc"')
        await browser.elementByCss('#broken-at-first-post').click()
        expect(
          await check(() => browser.eval('window.beforeClick'), {
            test(v) {
              return v !== 'abc'
            },
          })
        ).toBe(true)

        const text = await browser.elementByCss('#params').text()
        expect(text).toMatch(/post.*?post-999/)
      })
    }

    it('should support prerendered catchall route', async () => {
      const html = await renderViaHTTP(next.url, '/catchall/another/value')
      const $ = cheerio.load(html)

      expect(
        JSON.parse(cheerio.load(html)('#__NEXT_DATA__').text()).isFallback
      ).toBe(false)
      expect($('#catchall').text()).toMatch(/Hi.*?another value/)
    })

    it('should support lazy catchall route', async () => {
      const html = await renderViaHTTP(next.url, '/catchall/notreturnedinpaths')
      const $ = cheerio.load(html)
      expect($('#catchall').text()).toBe('fallback')

      // hydration
      const browser = await webdriver(next.url, '/catchall/delayby3s')

      const text1 = await browser.elementByCss('#catchall').text()
      expect(text1).toBe('fallback')

      await check(
        () => browser.elementByCss('#catchall').text(),
        /Hi.*?delayby3s/
      )
    })

    it('should support nested lazy catchall route', async () => {
      // We will render fallback for a "lazy" route
      const html = await renderViaHTTP(
        next.url,
        '/catchall/notreturnedinpaths/nested'
      )
      const $ = cheerio.load(html)
      expect($('#catchall').text()).toBe('fallback')

      // hydration
      const browser = await webdriver(next.url, '/catchall/delayby3s/nested')

      const text1 = await browser.elementByCss('#catchall').text()
      expect(text1).toBe('fallback')

      await check(
        () => browser.elementByCss('#catchall').text(),
        /Hi.*?delayby3s nested/
      )
    })

    it('should support prerendered catchall-explicit route (nested)', async () => {
      const html = await renderViaHTTP(
        next.url,
        '/catchall-explicit/another/value'
      )
      const $ = cheerio.load(html)

      expect(
        JSON.parse(cheerio.load(html)('#__NEXT_DATA__').text()).isFallback
      ).toBe(false)
      expect($('#catchall').text()).toMatch(/Hi.*?another value/)
    })

    it('should support prerendered catchall-explicit route (single)', async () => {
      const html = await renderViaHTTP(next.url, '/catchall-explicit/second')
      const $ = cheerio.load(html)

      expect(
        JSON.parse(cheerio.load(html)('#__NEXT_DATA__').text()).isFallback
      ).toBe(false)
      expect($('#catchall').text()).toMatch(/Hi.*?second/)
    })

    it('should handle fallback only page correctly HTML', async () => {
      const browser = await webdriver(next.url, '/fallback-only/first%2Fpost')

      const text = await browser.elementByCss('p').text()
      expect(text).toContain('hi fallback')

      // wait for fallback data to load
      await check(() => browser.elementByCss('p').text(), /Post/)

      // check fallback data
      const post = await browser.elementByCss('p').text()
      const query = JSON.parse(await browser.elementByCss('#query').text())
      const params = JSON.parse(await browser.elementByCss('#params').text())

      expect(post).toContain('first/post')
      expect(params).toEqual({
        slug: 'first/post',
      })
      expect(query).toEqual(params)
    })

    it('should handle fallback only page correctly data', async () => {
      const data = JSON.parse(
        await renderViaHTTP(
          next.url,
          `/_next/data/${next.buildId}/fallback-only/second%2Fpost.json`
        )
      )

      expect(data.pageProps.params).toEqual({
        slug: 'second/post',
      })
    })

    it('should 404 for a missing catchall explicit route', async () => {
      const res = await fetchViaHTTP(
        next.url,
        '/catchall-explicit/notreturnedinpaths'
      )
      expect(res.status).toBe(404)
      const html = await res.text()
      expect(html).toMatch(/This page could not be found/)
    })

    it('should 404 for an invalid data url', async () => {
      const res = await fetchViaHTTP(next.url, `/_next/data/${next.buildId}`)
      expect(res.status).toBe(404)
    })

    it('should allow rewriting to SSG page with fallback: false', async () => {
      const html = await renderViaHTTP(next.url, '/about')
      expect(html).toMatch(/About:.*?en/)
    })

    it("should allow rewriting to SSG page with fallback: 'blocking'", async () => {
      const html = await renderViaHTTP(next.url, '/blocked-create')
      expect(html).toMatch(/Post:.*?blocked-create/)
    })

    it('should fetch /_next/data correctly with mismatched href and as', async () => {
      const browser = await webdriver(next.url, '/')

      if (!dev) {
        await browser.eval(() =>
          document.querySelector('#to-rewritten-ssg').scrollIntoView()
        )

        await check(async () => {
          const hrefs = await browser.eval(
            `Object.keys(window.next.router.sdc)`
          )
          hrefs.sort()
          expect(
            hrefs.map((href) =>
              new URL(href).pathname.replace(/^\/_next\/data\/[^/]+/, '')
            )
          ).toContainEqual('/lang/en/about.json')
          return 'yes'
        }, 'yes')
      }
      await browser.eval('window.beforeNav = "hi"')
      await browser.elementByCss('#to-rewritten-ssg').click()
      await browser.waitForElementByCss('#about')

      expect(await browser.eval('window.beforeNav')).toBe('hi')
      expect(await browser.elementByCss('#about').text()).toBe('About: en')
    })

    it('should not error when rewriting to fallback dynamic SSG page', async () => {
      const item = Math.round(Math.random() * 100)
      const browser = await webdriver(next.url, `/some-rewrite/${item}`)

      await check(
        () => browser.elementByCss('p').text(),
        new RegExp(`Post: post-${item}`)
      )

      expect(JSON.parse(await browser.elementByCss('#params').text())).toEqual({
        post: `post-${item}`,
      })
      expect(JSON.parse(await browser.elementByCss('#query').text())).toEqual({
        post: `post-${item}`,
      })
    })

    if ((global as any).isNextDev) {
      it('should show warning when large amount of page data is returned', async () => {
        await renderViaHTTP(next.url, '/large-page-data')
        await check(
          () => next.cliOutput,
          /Warning: data for page "\/large-page-data" is 128 kB, this amount of data can reduce performance/
        )
      })

      it('should not show warning from url prop being returned', async () => {
        const urlPropPage = 'pages/url-prop.js'
        await next.patchFile(
          urlPropPage,
          `
        export async function getStaticProps() {
          return {
            props: {
              url: 'something'
            }
          }
        }

        export default ({ url }) => <p>url: {url}</p>
      `
        )

        const html = await renderViaHTTP(next.url, '/url-prop')
        await next.deleteFile(urlPropPage)
        expect(next.cliOutput).not.toMatch(
          /The prop `url` is a reserved prop in Next.js for legacy reasons and will be overridden on page \/url-prop/
        )
        expect(html).toMatch(/url:.*?something/)
      })

      it('should always show fallback for page not in getStaticPaths', async () => {
        const html = await renderViaHTTP(next.url, '/blog/post-321')
        const $ = cheerio.load(html)
        expect(JSON.parse($('#__NEXT_DATA__').text()).isFallback).toBe(true)

        // make another request to ensure it still is
        const html2 = await renderViaHTTP(next.url, '/blog/post-321')
        const $2 = cheerio.load(html2)
        expect(JSON.parse($2('#__NEXT_DATA__').text()).isFallback).toBe(true)
      })

      it('should not show fallback for page in getStaticPaths', async () => {
        const html = await renderViaHTTP(next.url, '/blog/post-1')
        const $ = cheerio.load(html)
        expect(JSON.parse($('#__NEXT_DATA__').text()).isFallback).toBe(false)

        // make another request to ensure it's still not
        const html2 = await renderViaHTTP(next.url, '/blog/post-1')
        const $2 = cheerio.load(html2)
        expect(JSON.parse($2('#__NEXT_DATA__').text()).isFallback).toBe(false)
      })

      it('should never show fallback for page not in getStaticPaths when blocking', async () => {
        const html = await renderViaHTTP(
          next.url,
          '/blocking-fallback-some/asf'
        )
        const $ = cheerio.load(html)
        expect(JSON.parse($('#__NEXT_DATA__').text()).isFallback).toBe(false)

        // make another request to ensure it still is
        const html2 = await renderViaHTTP(
          next.url,
          '/blocking-fallback-some/asf'
        )
        const $2 = cheerio.load(html2)
        expect(JSON.parse($2('#__NEXT_DATA__').text()).isFallback).toBe(false)
      })

      it('should not show fallback for page in getStaticPaths when blocking', async () => {
        const html = await renderViaHTTP(next.url, '/blocking-fallback-some/b')
        const $ = cheerio.load(html)
        expect(JSON.parse($('#__NEXT_DATA__').text()).isFallback).toBe(false)

        // make another request to ensure it's still not
        const html2 = await renderViaHTTP(next.url, '/blocking-fallback-some/b')
        const $2 = cheerio.load(html2)
        expect(JSON.parse($2('#__NEXT_DATA__').text()).isFallback).toBe(false)
      })

      it('should log error in console and browser in dev mode', async () => {
        const indexPage = 'pages/index.js'
        const origContent = await next.readFile(indexPage)

        const browser = await webdriver(next.url, '/')
        expect(await browser.elementByCss('p').text()).toMatch(/hello.*?world/)

        await next.patchFile(
          indexPage,
          origContent
            .replace('// throw new', 'throw new')
            .replace('{/* <div', '<div')
            .replace('</div> */}', '</div>')
        )
        await browser.waitForElementByCss('#after-change')
        // we need to reload the page to trigger getStaticProps
        await browser.refresh()

        expect(await hasRedbox(browser)).toBe(true)
        const errOverlayContent = await getRedboxHeader(browser)

        await next.patchFile(indexPage, origContent)
        const errorMsg = /oops from getStaticProps/
        expect(next.cliOutput).toMatch(errorMsg)
        expect(errOverlayContent).toMatch(errorMsg)
      })

      it('should always call getStaticProps without caching in dev', async () => {
        const initialRes = await fetchViaHTTP(next.url, '/something')
        expect(isCachingHeader(initialRes.headers.get('cache-control'))).toBe(
          false
        )
        const initialHtml = await initialRes.text()
        expect(initialHtml).toMatch(/hello.*?world/)

        const newRes = await fetchViaHTTP(next.url, '/something')
        expect(isCachingHeader(newRes.headers.get('cache-control'))).toBe(false)
        const newHtml = await newRes.text()
        expect(newHtml).toMatch(/hello.*?world/)
        expect(initialHtml !== newHtml).toBe(true)

        const newerRes = await fetchViaHTTP(next.url, '/something')
        expect(isCachingHeader(newerRes.headers.get('cache-control'))).toBe(
          false
        )
        const newerHtml = await newerRes.text()
        expect(newerHtml).toMatch(/hello.*?world/)
        expect(newHtml !== newerHtml).toBe(true)
      })

      it('should error on bad object from getStaticProps', async () => {
        const indexPage = 'pages/index.js'
        const origContent = await next.readFile(indexPage)
        await next.patchFile(
          indexPage,
          origContent.replace(/\/\/ bad-prop/, 'another: true,')
        )
        await waitFor(1000)
        try {
          const html = await renderViaHTTP(next.url, '/')
          expect(html).toMatch(/Additional keys were returned/)
        } finally {
          await next.patchFile(indexPage, origContent)
        }
      })

      it('should error on dynamic page without getStaticPaths', async () => {
        const curPage = 'pages/temp/[slug].js'
        await next.patchFile(
          curPage,
          `
          export async function getStaticProps() {
            return {
              props: {
                hello: 'world'
              }
            }
          }
          export default () => 'oops'
        `
        )
        await waitFor(1000)
        try {
          const html = await renderViaHTTP(next.url, '/temp/hello')
          expect(html).toMatch(
            /getStaticPaths is required for dynamic SSG pages and is missing for/
          )
        } finally {
          await next.deleteFile(curPage)
        }
      })

      it('should error on dynamic page without getStaticPaths returning fallback property', async () => {
        const curPage = 'pages/temp2/[slug].js'
        await next.patchFile(
          curPage,
          `
          export async function getStaticPaths() {
            return {
              paths: []
            }
          }
          export async function getStaticProps() {
            return {
              props: {
                hello: 'world'
              }
            }
          }
          export default () => 'oops'
        `
        )
        await waitFor(1000)
        try {
          const html = await renderViaHTTP(next.url, '/temp2/hello')
          expect(html).toMatch(/`fallback` key must be returned from/)
        } finally {
          await next.deleteFile(curPage)
        }
      })

      it('should not re-call getStaticProps when updating query', async () => {
        const browser = await webdriver(next.url, '/something?hello=world')
        await waitFor(2000)

        const query = await browser.elementByCss('#query').text()
        expect(JSON.parse(query)).toEqual({ hello: 'world' })

        const {
          props: {
            pageProps: { random: initialRandom },
          },
        } = await browser.eval('window.__NEXT_DATA__')

        const curRandom = await browser.elementByCss('#random').text()
        expect(curRandom).toBe(initialRandom + '')
      })

      it('should show fallback before invalid JSON is returned from getStaticProps', async () => {
        const html = await renderViaHTTP(next.url, '/non-json/foobar')
        expect(html).toContain('"isFallback":true')
      })

      it('should not fallback before invalid JSON is returned from getStaticProps when blocking fallback', async () => {
        const html = await renderViaHTTP(next.url, '/non-json-blocking/foobar')
        expect(html).toContain('"isFallback":false')
      })

      it('should show error for invalid JSON returned from getStaticProps on SSR', async () => {
        const browser = await webdriver(next.url, '/non-json/direct')

        // FIXME: enable this
        // expect(await getRedboxHeader(browser)).toMatch(
        //   /Error serializing `.time` returned from `getStaticProps`/
        // )

        // FIXME: disable this
        expect(await hasRedbox(browser)).toBe(true)
        expect(await getRedboxHeader(browser)).toMatch(
          /Failed to load static props/
        )
      })

      it('should show error for invalid JSON returned from getStaticProps on CST', async () => {
        const browser = await webdriver(next.url, '/')
        await browser.elementByCss('#non-json').click()

        // FIXME: enable this
        // expect(await getRedboxHeader(browser)).toMatch(
        //   /Error serializing `.time` returned from `getStaticProps`/
        // )

        // FIXME: disable this
        expect(await hasRedbox(browser)).toBe(true)
        expect(await getRedboxHeader(browser)).toMatch(
          /Failed to load static props/
        )
      })

      it('should not contain headers already sent error', async () => {
        await renderViaHTTP(next.url, '/fallback-only/some-fallback-post')
        expect(next.cliOutput).not.toContain('ERR_HTTP_HEADERS_SENT')
      })
    } else {
      it('should use correct caching headers for a no-revalidate page', async () => {
        const initialRes = await fetchViaHTTP(next.url, '/something')
        expect(initialRes.headers.get('cache-control')).toBe(
          's-maxage=31536000, stale-while-revalidate'
        )
        const initialHtml = await initialRes.text()
        expect(initialHtml).toMatch(/hello.*?world/)
      })

      it('should not show error for invalid JSON returned from getStaticProps on SSR', async () => {
        const browser = await webdriver(next.url, '/non-json/direct')

        await check(() => getBrowserBodyText(browser), /hello /)
      })

      it('should not show error for invalid JSON returned from getStaticProps on CST', async () => {
        const browser = await webdriver(next.url, '/')
        await browser.elementByCss('#non-json').click()
        await check(() => getBrowserBodyText(browser), /hello /)
      })

      if ((global as any).isNextStart) {
        it('outputs dataRoutes in routes-manifest correctly', async () => {
          const { dataRoutes } = JSON.parse(
            await next.readFile('.next/routes-manifest.json')
          )

          for (const route of dataRoutes) {
            route.dataRouteRegex = normalizeRegEx(route.dataRouteRegex)
          }

          expect(dataRoutes).toEqual([
            {
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapeRegex(next.buildId)}\\/index.json$`
              ),
              page: '/',
            },
            {
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapeRegex(
                  next.buildId
                )}\\/another.json$`
              ),
              page: '/another',
            },
            {
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapeRegex(
                  next.buildId
                )}\\/api\\-docs\\/(.+?)\\.json$`
              ),
              namedDataRouteRegex: `^/_next/data/${escapeRegex(
                next.buildId
              )}/api\\-docs/(?<slug>.+?)\\.json$`,
              page: '/api-docs/[...slug]',
              routeKeys: {
                slug: 'slug',
              },
            },
            {
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapeRegex(
                  next.buildId
                )}\\/bad-gssp.json$`
              ),
              page: '/bad-gssp',
            },
            {
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapeRegex(
                  next.buildId
                )}\\/bad-ssr.json$`
              ),
              page: '/bad-ssr',
            },
            {
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapeRegex(
                  next.buildId
                )}\\/blocking\\-fallback\\/([^\\/]+?)\\.json$`
              ),
              namedDataRouteRegex: `^/_next/data/${escapeRegex(
                next.buildId
              )}/blocking\\-fallback/(?<slug>[^/]+?)\\.json$`,
              page: '/blocking-fallback/[slug]',
              routeKeys: { slug: 'slug' },
            },
            {
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapeRegex(
                  next.buildId
                )}\\/blocking\\-fallback\\-once\\/([^\\/]+?)\\.json$`
              ),
              namedDataRouteRegex: `^/_next/data/${escapeRegex(
                next.buildId
              )}/blocking\\-fallback\\-once/(?<slug>[^/]+?)\\.json$`,
              page: '/blocking-fallback-once/[slug]',
              routeKeys: { slug: 'slug' },
            },
            {
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapeRegex(
                  next.buildId
                )}\\/blocking\\-fallback\\-some\\/([^\\/]+?)\\.json$`
              ),
              namedDataRouteRegex: `^/_next/data/${escapeRegex(
                next.buildId
              )}/blocking\\-fallback\\-some/(?<slug>[^/]+?)\\.json$`,
              page: '/blocking-fallback-some/[slug]',
              routeKeys: { slug: 'slug' },
            },
            {
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapeRegex(next.buildId)}\\/blog.json$`
              ),
              page: '/blog',
            },
            {
              namedDataRouteRegex: `^/_next/data/${escapeRegex(
                next.buildId
              )}/blog/(?<post>[^/]+?)\\.json$`,
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapeRegex(
                  next.buildId
                )}\\/blog\\/([^\\/]+?)\\.json$`
              ),
              page: '/blog/[post]',
              routeKeys: {
                post: 'post',
              },
            },
            {
              namedDataRouteRegex: `^/_next/data/${escapeRegex(
                next.buildId
              )}/blog/(?<post>[^/]+?)/(?<comment>[^/]+?)\\.json$`,
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapeRegex(
                  next.buildId
                )}\\/blog\\/([^\\/]+?)\\/([^\\/]+?)\\.json$`
              ),
              page: '/blog/[post]/[comment]',
              routeKeys: {
                post: 'post',
                comment: 'comment',
              },
            },
            {
              namedDataRouteRegex: `^/_next/data/${escapeRegex(
                next.buildId
              )}/catchall/(?<slug>.+?)\\.json$`,
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapeRegex(
                  next.buildId
                )}\\/catchall\\/(.+?)\\.json$`
              ),
              page: '/catchall/[...slug]',
              routeKeys: {
                slug: 'slug',
              },
            },
            {
              namedDataRouteRegex: `^/_next/data/${escapeRegex(
                next.buildId
              )}/catchall\\-explicit/(?<slug>.+?)\\.json$`,
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapeRegex(
                  next.buildId
                )}\\/catchall\\-explicit\\/(.+?)\\.json$`
              ),
              page: '/catchall-explicit/[...slug]',
              routeKeys: {
                slug: 'slug',
              },
            },
            {
              namedDataRouteRegex: `^/_next/data/${escapeRegex(
                next.buildId
              )}/catchall\\-optional(?:/(?<slug>.+?))?\\.json$`,
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapeRegex(
                  next.buildId
                )}\\/catchall\\-optional(?:\\/(.+?))?\\.json$`
              ),
              page: '/catchall-optional/[[...slug]]',
              routeKeys: {
                slug: 'slug',
              },
            },
            {
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapeRegex(
                  next.buildId
                )}\\/default-revalidate.json$`
              ),
              page: '/default-revalidate',
            },
            {
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapeRegex(
                  next.buildId
                )}\\/dynamic\\/([^\\/]+?)\\.json$`
              ),
              namedDataRouteRegex: `^/_next/data/${escapeRegex(
                next.buildId
              )}/dynamic/(?<slug>[^/]+?)\\.json$`,
              page: '/dynamic/[slug]',
              routeKeys: {
                slug: 'slug',
              },
            },
            {
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapeRegex(
                  next.buildId
                )}\\/fallback\\-only\\/([^\\/]+?)\\.json$`
              ),
              namedDataRouteRegex: `^/_next/data/${escapeRegex(
                next.buildId
              )}/fallback\\-only/(?<slug>[^/]+?)\\.json$`,
              page: '/fallback-only/[slug]',
              routeKeys: {
                slug: 'slug',
              },
            },
            {
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapeRegex(
                  next.buildId
                )}\\/index\\/index.json$`
              ),
              page: '/index',
            },
            {
              namedDataRouteRegex: `^/_next/data/${escapeRegex(
                next.buildId
              )}/lang/(?<lang>[^/]+?)/about\\.json$`,
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapeRegex(
                  next.buildId
                )}\\/lang\\/([^\\/]+?)\\/about\\.json$`
              ),
              page: '/lang/[lang]/about',
              routeKeys: {
                lang: 'lang',
              },
            },
            {
              dataRouteRegex: `^\\/_next\\/data\\/${escapeRegex(
                next.buildId
              )}\\/large-page-data.json$`,
              page: '/large-page-data',
            },
            {
              namedDataRouteRegex: `^/_next/data/${escapeRegex(
                next.buildId
              )}/non\\-json/(?<p>[^/]+?)\\.json$`,
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapeRegex(
                  next.buildId
                )}\\/non\\-json\\/([^\\/]+?)\\.json$`
              ),
              page: '/non-json/[p]',
              routeKeys: {
                p: 'p',
              },
            },
            {
              namedDataRouteRegex: `^/_next/data/${escapeRegex(
                next.buildId
              )}/non\\-json\\-blocking/(?<p>[^/]+?)\\.json$`,
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapeRegex(
                  next.buildId
                )}\\/non\\-json\\-blocking\\/([^\\/]+?)\\.json$`
              ),
              page: '/non-json-blocking/[p]',
              routeKeys: {
                p: 'p',
              },
            },
            {
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapeRegex(
                  next.buildId
                )}\\/something.json$`
              ),
              page: '/something',
            },
            {
              namedDataRouteRegex: `^/_next/data/${escapeRegex(
                next.buildId
              )}/user/(?<user>[^/]+?)/profile\\.json$`,
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapeRegex(
                  next.buildId
                )}\\/user\\/([^\\/]+?)\\/profile\\.json$`
              ),
              page: '/user/[user]/profile',
              routeKeys: {
                user: 'user',
              },
            },
          ])
        })

        it('outputs a prerender-manifest correctly', async () => {
          const manifest = JSON.parse(
            await next.readFile('.next/prerender-manifest.json')
          )
          const escapedBuildId = escapeRegex(next.buildId)

          Object.keys(manifest.dynamicRoutes).forEach((key) => {
            const item = manifest.dynamicRoutes[key]

            if (item.dataRouteRegex) {
              item.dataRouteRegex = normalizeRegEx(item.dataRouteRegex)
            }
            if (item.routeRegex) {
              item.routeRegex = normalizeRegEx(item.routeRegex)
            }
          })

          expect(manifest.version).toBe(3)
          expect(manifest.routes).toEqual(expectedManifestRoutes())
          expect(manifest.dynamicRoutes).toEqual({
            '/api-docs/[...slug]': {
              dataRoute: `/_next/data/${next.buildId}/api-docs/[...slug].json`,
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapedBuildId}\\/api\\-docs\\/(.+?)\\.json$`
              ),
              fallback: '/api-docs/[...slug].html',
              routeRegex: normalizeRegEx(`^\\/api\\-docs\\/(.+?)(?:\\/)?$`),
            },
            '/blocking-fallback-once/[slug]': {
              dataRoute: `/_next/data/${next.buildId}/blocking-fallback-once/[slug].json`,
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapedBuildId}\\/blocking\\-fallback\\-once\\/([^\\/]+?)\\.json$`
              ),
              fallback: null,
              routeRegex: normalizeRegEx(
                '^\\/blocking\\-fallback\\-once\\/([^\\/]+?)(?:\\/)?$'
              ),
            },
            '/blocking-fallback-some/[slug]': {
              dataRoute: `/_next/data/${next.buildId}/blocking-fallback-some/[slug].json`,
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapedBuildId}\\/blocking\\-fallback\\-some\\/([^\\/]+?)\\.json$`
              ),
              fallback: null,
              routeRegex: normalizeRegEx(
                '^\\/blocking\\-fallback\\-some\\/([^\\/]+?)(?:\\/)?$'
              ),
            },
            '/blocking-fallback/[slug]': {
              dataRoute: `/_next/data/${next.buildId}/blocking-fallback/[slug].json`,
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapedBuildId}\\/blocking\\-fallback\\/([^\\/]+?)\\.json$`
              ),
              fallback: null,
              routeRegex: normalizeRegEx(
                '^\\/blocking\\-fallback\\/([^\\/]+?)(?:\\/)?$'
              ),
            },
            '/blog/[post]': {
              fallback: '/blog/[post].html',
              dataRoute: `/_next/data/${next.buildId}/blog/[post].json`,
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapedBuildId}\\/blog\\/([^\\/]+?)\\.json$`
              ),
              routeRegex: normalizeRegEx('^\\/blog\\/([^\\/]+?)(?:\\/)?$'),
            },
            '/blog/[post]/[comment]': {
              fallback: '/blog/[post]/[comment].html',
              dataRoute: `/_next/data/${next.buildId}/blog/[post]/[comment].json`,
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapedBuildId}\\/blog\\/([^\\/]+?)\\/([^\\/]+?)\\.json$`
              ),
              routeRegex: normalizeRegEx(
                '^\\/blog\\/([^\\/]+?)\\/([^\\/]+?)(?:\\/)?$'
              ),
            },
            '/dynamic/[slug]': {
              dataRoute: `/_next/data/${next.buildId}/dynamic/[slug].json`,
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapedBuildId}\\/dynamic\\/([^\\/]+?)\\.json$`
              ),
              fallback: false,
              routeRegex: normalizeRegEx(`^\\/dynamic\\/([^\\/]+?)(?:\\/)?$`),
            },
            '/fallback-only/[slug]': {
              dataRoute: `/_next/data/${next.buildId}/fallback-only/[slug].json`,
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapedBuildId}\\/fallback\\-only\\/([^\\/]+?)\\.json$`
              ),
              fallback: '/fallback-only/[slug].html',
              routeRegex: normalizeRegEx(
                '^\\/fallback\\-only\\/([^\\/]+?)(?:\\/)?$'
              ),
            },
            '/lang/[lang]/about': {
              dataRoute: `/_next/data/${next.buildId}/lang/[lang]/about.json`,
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapedBuildId}\\/lang\\/([^\\/]+?)\\/about\\.json$`
              ),
              fallback: false,
              routeRegex: normalizeRegEx(
                '^\\/lang\\/([^\\/]+?)\\/about(?:\\/)?$'
              ),
            },
            '/non-json-blocking/[p]': {
              dataRoute: `/_next/data/${next.buildId}/non-json-blocking/[p].json`,
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapedBuildId}\\/non\\-json\\-blocking\\/([^\\/]+?)\\.json$`
              ),
              fallback: null,
              routeRegex: normalizeRegEx(
                '^\\/non\\-json\\-blocking\\/([^\\/]+?)(?:\\/)?$'
              ),
            },
            '/non-json/[p]': {
              dataRoute: `/_next/data/${next.buildId}/non-json/[p].json`,
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapedBuildId}\\/non\\-json\\/([^\\/]+?)\\.json$`
              ),
              fallback: '/non-json/[p].html',
              routeRegex: normalizeRegEx(
                '^\\/non\\-json\\/([^\\/]+?)(?:\\/)?$'
              ),
            },
            '/user/[user]/profile': {
              fallback: '/user/[user]/profile.html',
              dataRoute: `/_next/data/${next.buildId}/user/[user]/profile.json`,
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapedBuildId}\\/user\\/([^\\/]+?)\\/profile\\.json$`
              ),
              routeRegex: normalizeRegEx(
                `^\\/user\\/([^\\/]+?)\\/profile(?:\\/)?$`
              ),
            },

            '/catchall/[...slug]': {
              fallback: '/catchall/[...slug].html',
              routeRegex: normalizeRegEx('^\\/catchall\\/(.+?)(?:\\/)?$'),
              dataRoute: `/_next/data/${next.buildId}/catchall/[...slug].json`,
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapedBuildId}\\/catchall\\/(.+?)\\.json$`
              ),
            },
            '/catchall-optional/[[...slug]]': {
              dataRoute: `/_next/data/${next.buildId}/catchall-optional/[[...slug]].json`,
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapedBuildId}\\/catchall\\-optional(?:\\/(.+?))?\\.json$`
              ),
              fallback: false,
              routeRegex: normalizeRegEx(
                '^\\/catchall\\-optional(?:\\/(.+?))?(?:\\/)?$'
              ),
            },
            '/catchall-explicit/[...slug]': {
              dataRoute: `/_next/data/${next.buildId}/catchall-explicit/[...slug].json`,
              dataRouteRegex: normalizeRegEx(
                `^\\/_next\\/data\\/${escapedBuildId}\\/catchall\\-explicit\\/(.+?)\\.json$`
              ),
              fallback: false,
              routeRegex: normalizeRegEx(
                '^\\/catchall\\-explicit\\/(.+?)(?:\\/)?$'
              ),
            },
          })
        })

        it('outputs prerendered files correctly', async () => {
          const routes = [
            '/another',
            '/something',
            '/blog/post-1',
            '/blog/post-2/comment-2',
          ]

          for (const route of routes) {
            await next.readFile(join('.next/server/pages', `${route}.html`))
            await next.readFile(join('.next/server/pages', `${route}.json`))
          }
        })

        it('should handle de-duping correctly', async () => {
          let vals = new Array(10).fill(null)

          // use data route so we don't get the fallback
          vals = await Promise.all(
            vals.map(() =>
              renderViaHTTP(
                next.url,
                `/_next/data/${next.buildId}/blog/post-10.json`
              )
            )
          )
          const val = vals[0]

          expect(JSON.parse(val).pageProps.post).toBe('post-10')
          expect(new Set(vals).size).toBe(1)
        })
      }

      it('should not revalidate when set to false', async () => {
        const route = '/something'
        const initialHtml = await renderViaHTTP(next.url, route)
        let newHtml = await renderViaHTTP(next.url, route)
        expect(initialHtml).toBe(newHtml)

        newHtml = await renderViaHTTP(next.url, route)
        expect(initialHtml).toBe(newHtml)

        newHtml = await renderViaHTTP(next.url, route)
        expect(initialHtml).toBe(newHtml)
      })

      it('should not revalidate when set to false in blocking fallback mode', async () => {
        const route = '/blocking-fallback-once/test-no-revalidate'

        const initialHtml = await renderViaHTTP(next.url, route)
        let newHtml = await renderViaHTTP(next.url, route)
        expect(initialHtml).toBe(newHtml)

        newHtml = await renderViaHTTP(next.url, route)
        expect(initialHtml).toBe(newHtml)

        newHtml = await renderViaHTTP(next.url, route)
        expect(initialHtml).toBe(newHtml)
      })

      it('should handle revalidating HTML correctly', async () => {
        const route = '/blog/post-2/comment-2'
        await renderViaHTTP(next.url, route)
        const initialHtml = await renderViaHTTP(next.url, route)
        expect(initialHtml).toMatch(/Post:.*?post-2/)
        expect(initialHtml).toMatch(/Comment:.*?comment-2/)

        let newHtml = await renderViaHTTP(next.url, route)
        expect(newHtml).toBe(initialHtml)

        await waitFor(2 * 1000)
        await renderViaHTTP(next.url, route)

        await waitFor(2 * 1000)
        newHtml = await renderViaHTTP(next.url, route)
        expect(newHtml === initialHtml).toBe(false)
        expect(newHtml).toMatch(/Post:.*?post-2/)
        expect(newHtml).toMatch(/Comment:.*?comment-2/)
      })

      it('should handle revalidating JSON correctly', async () => {
        const route = `/_next/data/${next.buildId}/blog/post-2/comment-3.json`
        const initialJson = await renderViaHTTP(next.url, route)
        expect(initialJson).toMatch(/post-2/)
        expect(initialJson).toMatch(/comment-3/)

        let newJson = await renderViaHTTP(next.url, route)
        expect(newJson).toBe(initialJson)

        await waitFor(2 * 1000)
        await renderViaHTTP(next.url, route)

        await waitFor(2 * 1000)
        newJson = await renderViaHTTP(next.url, route)
        expect(newJson === initialJson).toBe(false)
        expect(newJson).toMatch(/post-2/)
        expect(newJson).toMatch(/comment-3/)
      })

      it('should handle revalidating HTML correctly with blocking', async () => {
        const route = '/blocking-fallback/pewpew'
        const initialHtml = await renderViaHTTP(next.url, route)
        expect(initialHtml).toMatch(/Post:.*?pewpew/)

        let newHtml = await renderViaHTTP(next.url, route)
        expect(newHtml).toBe(initialHtml)

        await waitFor(2 * 1000)
        await renderViaHTTP(next.url, route)

        await waitFor(2 * 1000)
        newHtml = await renderViaHTTP(next.url, route)
        expect(newHtml === initialHtml).toBe(false)
        expect(newHtml).toMatch(/Post:.*?pewpew/)
      })

      it('should handle revalidating JSON correctly with blocking', async () => {
        const route = `/_next/data/${next.buildId}/blocking-fallback/pewpewdata.json`
        const initialJson = await renderViaHTTP(next.url, route)
        expect(initialJson).toMatch(/pewpewdata/)

        let newJson = await renderViaHTTP(next.url, route)
        expect(newJson).toBe(initialJson)

        await waitFor(2 * 1000)
        await renderViaHTTP(next.url, route)

        await waitFor(2 * 1000)
        newJson = await renderViaHTTP(next.url, route)
        expect(newJson === initialJson).toBe(false)
        expect(newJson).toMatch(/pewpewdata/)
      })

      it('should handle revalidating HTML correctly with blocking and seed', async () => {
        const route = '/blocking-fallback/a'
        const initialHtml = await renderViaHTTP(next.url, route)
        const $initial = cheerio.load(initialHtml)
        expect($initial('p').text()).toBe('Post: a')

        let newHtml = await renderViaHTTP(next.url, route)
        expect(newHtml).toBe(initialHtml)

        await waitFor(2 * 1000)
        await renderViaHTTP(next.url, route)

        await waitFor(2 * 1000)
        newHtml = await renderViaHTTP(next.url, route)
        expect(newHtml === initialHtml).toBe(false)
        const $new = cheerio.load(newHtml)
        expect($new('p').text()).toBe('Post: a')
      })

      it('should handle revalidating JSON correctly with blocking and seed', async () => {
        const route = `/_next/data/${next.buildId}/blocking-fallback/b.json`
        const initialJson = await renderViaHTTP(next.url, route)
        expect(JSON.parse(initialJson)).toMatchObject({
          pageProps: { params: { slug: 'b' } },
        })

        let newJson = await renderViaHTTP(next.url, route)
        expect(newJson).toBe(initialJson)

        await waitFor(2 * 1000)
        await renderViaHTTP(next.url, route)

        await waitFor(2 * 1000)
        newJson = await renderViaHTTP(next.url, route)
        expect(newJson === initialJson).toBe(false)
        expect(JSON.parse(newJson)).toMatchObject({
          pageProps: { params: { slug: 'b' } },
        })
      })

      it('should not fetch prerender data on mount', async () => {
        const browser = await webdriver(next.url, '/blog/post-100')
        await browser.eval('window.thisShouldStay = true')
        await waitFor(2 * 1000)
        const val = await browser.eval('window.thisShouldStay')
        expect(val).toBe(true)
      })

      it('should not error when flushing cache files', async () => {
        await fetchViaHTTP(next.url, '/user/user-1/profile')
        await waitFor(500)
        expect(next.cliOutput).not.toMatch(
          /Failed to update prerender files for/
        )
      })
    }

    // this should come very last
    it('should not have attempted sending invalid payload', async () => {
      expect(next.cliOutput).not.toContain('argument entity must be string')
    })

    if ((global as any).isNextStart) {
      it('should of formatted build output correctly', () => {
        expect(next.cliOutput).toMatch(/○ \/normal/)
        expect(next.cliOutput).toMatch(/● \/blog\/\[post\]/)
        expect(next.cliOutput).toMatch(/\+2 more paths/)
      })

      it('should output traces', async () => {
        const checks = [
          {
            page: '/_app',
            tests: [
              /webpack-runtime\.js/,
              /node_modules\/react\/index\.js/,
              /node_modules\/react\/package\.json/,
              /node_modules\/react\/cjs\/react\.production\.min\.js/,
              /node_modules\/next/,
            ],
            notTests: [],
          },
          {
            page: '/another',
            tests: [
              /webpack-runtime\.js/,
              /chunks\/.*?\.js/,
              /node_modules\/react\/index\.js/,
              /node_modules\/react\/package\.json/,
              /node_modules\/react\/cjs\/react\.production\.min\.js/,
              /node_modules\/next/,
              /\/world.txt/,
            ],
            notTests: [
              /node_modules\/@firebase\/firestore\/.*?\.js/,
              /\/server\.js/,
            ],
          },
          {
            page: '/blog/[post]',
            tests: [
              /webpack-runtime\.js/,
              /chunks\/.*?\.js/,
              /node_modules\/react\/index\.js/,
              /node_modules\/react\/package\.json/,
              /node_modules\/react\/cjs\/react\.production\.min\.js/,
              /node_modules\/next/,
              /next\/router\.js/,
              /next\/dist\/client\/router\.js/,
              /node_modules\/@firebase\/firestore\/.*?\.js/,
            ],
            notTests: [/\/world.txt/],
          },
        ]

        for (const check of checks) {
          const contents = await next.readFile(
            join('.next/server/pages/', check.page + '.js.nft.json')
          )
          const { version, files } = JSON.parse(contents)
          expect(version).toBe(1)

          expect(
            check.tests.every((item) => files.some((file) => item.test(file)))
          ).toBe(true)

          if (sep === '/') {
            expect(
              check.notTests.some((item) =>
                files.some((file) => item.test(file))
              )
            ).toBe(false)
          }
        }
      })
    }
  }
  runTests((global as any).isNextDev)
})
