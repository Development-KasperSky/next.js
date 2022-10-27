/* eslint-env jest */

import cheerio from 'cheerio'
import { join } from 'path'
import fs from 'fs-extra'
import {
  killApp,
  findPort,
  nextStart,
  nextBuild,
  renderViaHTTP,
  waitFor,
} from 'next-test-utils'
import webdriver from 'next-webdriver'

const fixturesDir = join(__dirname, '..', 'fixtures')

const fsExists = (file) =>
  fs
    .access(file)
    .then(() => true)
    .catch(() => false)

describe('Font Optimization', () => {
  describe.each([
    [
      'google',
      [
        'https://fonts.googleapis.com/css?family=Voces',
        'https://fonts.googleapis.com/css2?family=Modak',
        'https://fonts.googleapis.com/css2?family=Roboto:wght@700',
        'https://fonts.googleapis.com/css2?family=Roboto:wght@400;700;900&display=swap',
      ],
      [
        /<style data-href="https:\/\/fonts\.googleapis\.com\/css\?family=Voces">.*<\/style>/,
        /<style data-href="https:\/\/fonts\.googleapis\.com\/css2\?family=Modak">.*<\/style>/,
        /<style data-href="https:\/\/fonts\.googleapis\.com\/css2\?family=Roboto:wght@700">.*<\/style>/,
        /<style data-href="https:\/\/fonts.googleapis.com\/css2\?family=Roboto:wght@400;700;900&display=swap">.*<\/style>/,
      ],
      'https://fonts.gstatic.com',
    ],
    [
      'typekit',
      [
        'https://use.typekit.net/plm1izr.css',
        'https://use.typekit.net/erd0sed.css',
        'https://use.typekit.net/ucs7mcf.css',
        'https://use.typekit.net/ucs7mcf.css',
      ],
      [
        /<style data-href="https:\/\/use.typekit.net\/plm1izr.css">.*<\/style>/,
        /<style data-href="https:\/\/use.typekit.net\/erd0sed.css">.*<\/style>/,
        /<style data-href="https:\/\/use.typekit.net\/ucs7mcf.css">.*<\/style>/,
        /<style data-href="https:\/\/use.typekit.net\/ucs7mcf.css">.*<\/style>/,
      ],
      'https://use.typekit.net',
    ],
  ])(
    'with-%s',
    (
      property,
      [staticFont, staticHeadFont, starsFont, withFont],
      [staticPattern, staticHeadPattern, starsPattern, withFontPattern],
      preconnectUrl
    ) => {
      const appDir = join(fixturesDir, `with-${property}`)
      let builtServerPagesDir
      let builtPage
      let appPort
      let app

      function runTests() {
        it('should pass nonce to the inlined font definition', async () => {
          const html = await renderViaHTTP(appPort, '/nonce')
          const $ = cheerio.load(html)
          expect(await fsExists(builtPage('font-manifest.json'))).toBe(true)

          const link = $(
            `link[rel="stylesheet"][data-href="${staticHeadFont}"]`
          )

          const style = $(`style[data-href="${staticHeadFont}"]`)
          const styleNonce = style.attr('nonce')

          expect(link.length).toBe(0)
          expect(styleNonce).toBe('VmVyY2Vs')
        })

        it('should only inline included fonts per page', async () => {
          const html = await renderViaHTTP(appPort, '/with-font')
          expect(await fsExists(builtPage('font-manifest.json'))).toBe(true)

          const $ = cheerio.load(html)

          expect($(`link[data-href="${withFont}"]`).length).toBe(0)

          expect(html).toMatch(withFontPattern)

          const htmlWithoutFont = await renderViaHTTP(appPort, '/without-font')
          const $2 = cheerio.load(htmlWithoutFont)

          expect($2(`link[data-href="${withFont}"]`).length).toBe(0)
          expect(htmlWithoutFont).not.toMatch(withFontPattern)
        })

        it(`should inline the ${property} fonts for static pages`, async () => {
          const html = await renderViaHTTP(appPort, '/')
          const $ = cheerio.load(html)
          expect(await fsExists(builtPage('font-manifest.json'))).toBe(true)
          expect(
            $(`link[rel=stylesheet][data-href="${staticFont}"]`).length
          ).toBe(0)
          expect(html).toMatch(staticPattern)
        })

        it(`should inline the ${property} fonts for static pages with Next/Head`, async () => {
          const html = await renderViaHTTP(appPort, '/static-head')
          const $ = cheerio.load(html)
          expect(await fsExists(builtPage('font-manifest.json'))).toBe(true)
          expect(
            $(`link[rel=stylesheet][data-href="${staticHeadFont}"]`).length
          ).toBe(0)
          expect(html).toMatch(staticHeadPattern)
        })

        it(`should inline the ${property} fonts for SSR pages`, async () => {
          const html = await renderViaHTTP(appPort, '/stars')
          const $ = cheerio.load(html)
          expect(await fsExists(builtPage('font-manifest.json'))).toBe(true)
          expect(
            $(`link[rel=stylesheet][data-href="${starsFont}"]`).length
          ).toBe(0)
          expect(html).toMatch(starsPattern)
        })

        it(`should add preconnect tag`, async () => {
          const html = await renderViaHTTP(appPort, '/stars')
          const $ = cheerio.load(html)
          expect(
            $(`link[rel=preconnect][href="${preconnectUrl}"]`).length
          ).toBe(1)
        })

        it('should skip this optimization for AMP pages', async () => {
          const html = await renderViaHTTP(appPort, '/amp')
          const $ = cheerio.load(html)
          expect(await fsExists(builtPage('font-manifest.json'))).toBe(true)
          expect($(`link[rel=stylesheet][href="${staticFont}"]`).length).toBe(1)
          expect(html).not.toMatch(staticPattern)
        })

        it('should work for fonts loaded on navigation', async () => {
          let browser
          try {
            browser = await webdriver(appPort, '/')
            await waitFor(1000)

            const baseFont = await browser.elementByCss(
              `style[data-href="${staticFont}"]`
            )
            expect(baseFont).toBeDefined()

            await browser.waitForElementByCss('#with-font')
            await browser.click('#with-font')

            await browser.waitForElementByCss('#with-font-container')
            const pageFontCss = await browser.elementsByCss(
              `style[data-href="${withFont}"]`
            )
            expect(pageFontCss.length).toBe(0)
            const pageFont = await browser.elementByCss(
              `link[href="${withFont}"]`
            )
            expect(pageFont).toBeDefined()
          } finally {
            if (browser) await browser.close()
          }
        })

        it('should minify the css', async () => {
          const snapshotJson = JSON.parse(
            await fs.readFile(join(appDir, 'manifest-snapshot.json'), {
              encoding: 'utf-8',
            })
          )
          const testJson = JSON.parse(
            await fs.readFile(builtPage('font-manifest.json'), {
              encoding: 'utf-8',
            })
          )
          const normalizeContent = (content) => {
            return content.replace(/\/v[\d]{1,}\//g, '/v0/')
          }
          const testCss = {}
          testJson.forEach((fontDefinition) => {
            testCss[fontDefinition.url] = normalizeContent(
              fontDefinition.content
            )
          })
          const snapshotCss = {}
          snapshotJson.forEach((fontDefinition) => {
            snapshotCss[fontDefinition.url] = normalizeContent(
              fontDefinition.content
            )
          })

          expect(testCss).toStrictEqual(snapshotCss)
        })

        // Re-run build to check if it works when build is cached
        it('should work when build is cached', async () => {
          await nextBuild(appDir)
          const testJson = JSON.parse(
            await fs.readFile(builtPage('font-manifest.json'), {
              encoding: 'utf-8',
            })
          )
          expect(testJson.length).toBeGreaterThan(0)
        })
      }

      describe('Font optimization for SSR apps', () => {
        beforeAll(async () => {
          if (fs.pathExistsSync(join(appDir, '.next'))) {
            await fs.remove(join(appDir, '.next'))
          }
          await nextBuild(appDir)
          appPort = await findPort()
          app = await nextStart(appDir, appPort)
          builtServerPagesDir = join(appDir, '.next', 'server')
          builtPage = (file) => join(builtServerPagesDir, file)
        })
        afterAll(() => killApp(app))
        runTests()
      })

      describe('Font optimization for unreachable font definitions.', () => {
        beforeAll(async () => {
          await nextBuild(appDir)
          await fs.writeFile(
            join(appDir, '.next', 'server', 'font-manifest.json'),
            '[]',
            'utf8'
          )
          appPort = await findPort()
          app = await nextStart(appDir, appPort)
          builtServerPagesDir = join(appDir, '.next', 'server')
          builtPage = (file) => join(builtServerPagesDir, file)
        })
        afterAll(() => killApp(app))
        it('should fallback to normal stylesheet if the contents of the fonts are unreachable', async () => {
          const html = await renderViaHTTP(appPort, '/stars')
          expect(await fsExists(builtPage('font-manifest.json'))).toBe(true)
          expect(html).toContain(`<link rel="stylesheet" href="${starsFont}"/>`)
        })
        it('should not inline multiple fallback link tag', async () => {
          await renderViaHTTP(appPort, '/stars')
          // second render to make sure that the page is requested more than once.
          const html = await renderViaHTTP(appPort, '/stars')
          expect(await fsExists(builtPage('font-manifest.json'))).toBe(true)
          expect(html).not.toContain(
            `<link rel="stylesheet" href="${staticFont}"/><link rel="stylesheet" href="${starsFont}"/><link rel="stylesheet" href="${staticFont}"/><link rel="stylesheet" href="${starsFont}"/>`
          )
        })
      })
    }
  )

  test('Spread operator regression on <link>', async () => {
    const appDir = join(fixturesDir, 'spread-operator-regression')
    const { code } = await nextBuild(appDir)
    expect(code).toBe(0)
  })

  test('makeStylesheetInert regression', async () => {
    const appDir = join(fixturesDir, 'make-stylesheet-inert-regression')
    const { code } = await nextBuild(appDir)
    expect(code).toBe(0)
  })

  describe('font override', () => {
    let app, appPort

    beforeAll(async () => {
      const appDir = join(fixturesDir, 'font-override')
      await nextBuild(appDir)
      appPort = await findPort()
      app = await nextStart(appDir, appPort)
    })
    afterAll(() => killApp(app))
    it('should inline font-override values', async () => {
      const html = await renderViaHTTP(appPort, '/')
      const $ = cheerio.load(html)
      const inlineStyle = $(
        'style[data-href="https://fonts.googleapis.com/css2?family=Roboto&display=swap"]'
      )
      const inlineStyleMultiple = $(
        'style[data-href="https://fonts.googleapis.com/css2?family=Open+Sans&family=Libre+Baskerville&display=swap"]'
      )
      expect(inlineStyle.length).toBe(1)
      expect(inlineStyle.html()).toContain(
        '@font-face{font-family:"Roboto Fallback";ascent-override:92.77%;descent-override:24.41%;line-gap-override:0.00%;src:local("Arial")}'
      )
      expect(inlineStyleMultiple.length).toBe(1)
      expect(inlineStyleMultiple.html()).toContain(
        '@font-face{font-family:"Libre Baskerville Fallback";ascent-override:97.00%;descent-override:27.00%;line-gap-override:0.00%;src:local("Times New Roman")}'
      )
      expect(inlineStyleMultiple.html()).toContain(
        '@font-face{font-family:"Open Sans Fallback";ascent-override:106.88%;descent-override:29.30%;line-gap-override:0.00%;src:local("Arial")}'
      )
    })
  })

  describe('font override with size adjust', () => {
    let app, appPort

    beforeAll(async () => {
      const appDir = join(fixturesDir, 'font-override-size-adjust')
      await nextBuild(appDir)
      appPort = await findPort()
      app = await nextStart(appDir, appPort)
    })
    afterAll(() => killApp(app))
    it('should inline font-override values', async () => {
      const html = await renderViaHTTP(appPort, '/')
      const $ = cheerio.load(html)
      const inlineStyle = $(
        'style[data-href="https://fonts.googleapis.com/css2?family=Roboto&display=swap"]'
      )
      const inlineStyleMultiple = $(
        'style[data-href="https://fonts.googleapis.com/css2?family=Open+Sans&family=Libre+Baskerville&display=swap"]'
      )
      expect(inlineStyle.length).toBe(1)
      expect(inlineStyle.html()).toContain(
        '@font-face{font-family:"Roboto Fallback";ascent-override:92.49%;descent-override:24.34%;line-gap-override:0.00%;size-adjust:100.30%;src:local("Arial")}'
      )
      expect(inlineStyleMultiple.length).toBe(1)
      expect(inlineStyleMultiple.html()).toContain(
        '@font-face{font-family:"Libre Baskerville Fallback";ascent-override:76.28%;descent-override:21.23%;line-gap-override:0.00%;size-adjust:127.17%;src:local("Times New Roman")}'
      )
      expect(inlineStyleMultiple.html()).toContain(
        '@font-face{font-family:"Open Sans Fallback";ascent-override:101.58%;descent-override:27.84%;line-gap-override:0.00%;size-adjust:105.22%;src:local("Arial")}'
      )
    })
  })
})
