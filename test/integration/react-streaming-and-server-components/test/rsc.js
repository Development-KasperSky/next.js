/* eslint-env jest */
import webdriver from 'next-webdriver'
import cheerio from 'cheerio'
import { renderViaHTTP, check } from 'next-test-utils'

function getNodeBySelector(html, selector) {
  const $ = cheerio.load(html)
  return $(selector)
}

export default function (context, runtime) {
  it('should render server components correctly', async () => {
    const homeHTML = await renderViaHTTP(context.appPort, '/', null, {
      headers: {
        'x-next-test-client': 'test-util',
      },
    })

    // should have only 1 DOCTYPE
    expect(homeHTML).toMatch(/^<!DOCTYPE html><html/)

    expect(homeHTML).toContain('component:index.server')
    expect(homeHTML).toContain('env:env_var_test')
    expect(homeHTML).toContain('header:test-util')
    expect(homeHTML).toContain('path:/')
    expect(homeHTML).toContain('foo.client')
  })

  it('should support multi-level server component imports', async () => {
    const html = await renderViaHTTP(context.appPort, '/multi')
    expect(html).toContain('bar.server.js:')
    expect(html).toContain('foo.client')
  })

  it('should support next/link in server components', async () => {
    const linkHTML = await renderViaHTTP(context.appPort, '/next-api/link')
    const linkText = getNodeBySelector(
      linkHTML,
      'div[hidden] > a[href="/"]'
    ).text()

    expect(linkText).toContain('go home')

    const browser = await webdriver(context.appPort, '/next-api/link')

    // We need to make sure the app is fully hydrated before clicking, otherwise
    // it will be a full redirection instead of being taken over by the next
    // router. This timeout prevents it being flaky caused by fast refresh's
    // rebuilding event.
    await new Promise((res) => setTimeout(res, 1000))
    await browser.eval('window.beforeNav = 1')

    await browser.waitForElementByCss('#next_id').click()
    await check(() => browser.elementByCss('#query').text(), 'query:1')

    await browser.waitForElementByCss('#next_id').click()
    await check(() => browser.elementByCss('#query').text(), 'query:2')

    expect(await browser.eval('window.beforeNav')).toBe(1)
  })

  // Disable next/image for nodejs runtime temporarily
  if (runtime === 'edge') {
    it('should suspense next/image in server components', async () => {
      const imageHTML = await renderViaHTTP(context.appPort, '/next-api/image')
      const imageTag = getNodeBySelector(
        imageHTML,
        'div[hidden] > span > span > img'
      )

      expect(imageTag.attr('src')).toContain('data:image')
    })
  }

  it('should handle multiple named exports correctly', async () => {
    const clientExportsHTML = await renderViaHTTP(
      context.appPort,
      '/client-exports'
    )

    expect(
      getNodeBySelector(
        clientExportsHTML,
        'div[hidden] > div > #named-exports'
      ).text()
    ).toBe('abcde')
    expect(
      getNodeBySelector(
        clientExportsHTML,
        'div[hidden] > div > #default-exports-arrow'
      ).text()
    ).toBe('client-default-export-arrow')

    const browser = await webdriver(context.appPort, '/client-exports')
    const textNamedExports = await browser
      .waitForElementByCss('#named-exports')
      .text()
    const textDefaultExportsArrow = await browser
      .waitForElementByCss('#default-exports-arrow')
      .text()
    expect(textNamedExports).toBe('abcde')
    expect(textDefaultExportsArrow).toBe('client-default-export-arrow')
  })

  it('should handle 404 requests and missing routes correctly', async () => {
    const id = '#text'
    const content = 'custom-404-page'
    const page404HTML = await renderViaHTTP(context.appPort, '/404')
    const pageUnknownHTML = await renderViaHTTP(context.appPort, '/no.where')

    const page404Browser = await webdriver(context.appPort, '/404')
    const pageUnknownBrowser = await webdriver(context.appPort, '/no.where')

    expect(await page404Browser.waitForElementByCss(id).text()).toBe(content)
    expect(await pageUnknownBrowser.waitForElementByCss(id).text()).toBe(
      content
    )

    expect(getNodeBySelector(page404HTML, id).text()).toBe(content)
    expect(getNodeBySelector(pageUnknownHTML, id).text()).toBe(content)
  })
}
