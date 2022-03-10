import webdriver from 'next-webdriver'
import { renderViaHTTP } from 'next-test-utils'

export default async function basic(context, { env }) {
  it('should render 404 error correctly', async () => {
    const path404HTML = await renderViaHTTP(context.appPort, '/404')
    const pathNotFoundHTML = await renderViaHTTP(context.appPort, '/not-found')

    expect(path404HTML).toContain('custom-404-page')
    expect(pathNotFoundHTML).toContain('custom-404-page')
  })

  it('should render dynamic routes correctly', async () => {
    const dynamicRoute1HTML = await renderViaHTTP(
      context.appPort,
      '/routes/dynamic1'
    )
    const dynamicRoute2HTML = await renderViaHTTP(
      context.appPort,
      '/routes/dynamic2'
    )

    expect(dynamicRoute1HTML).toContain('query: dynamic1')
    expect(dynamicRoute2HTML).toContain('query: dynamic2')
  })

  it('should support api routes', async () => {
    const res = await renderViaHTTP(context.appPort, '/api/ping')
    expect(res).toContain('pong')
  })

  it('should handle suspense error page correctly (node stream)', async () => {
    const browser = await webdriver(context.appPort, '/404')
    const hydrationContent = await browser.waitForElementByCss('#__next').text()

    expect(hydrationContent).toBe('custom-404-pagenext_streaming_data')
  })

  it('should render 500 error correctly', async () => {
    const errPaths = ['/err', '/err/render']
    const promises = errPaths.map(async (pagePath) => {
      const html = await renderViaHTTP(context.appPort, pagePath)
      if (env === 'dev') {
        // In dev mode it should show the error popup.
        expect(html).toContain('Error: oops')
      } else {
        expect(html).toContain('custom-500-page')
      }
    })
    await Promise.all(promises)
  })

  it('should render fallback if error raised from suspense during streaming', async () => {
    const html = await renderViaHTTP(context.appPort, '/err/suspense')
    expect(html).toContain('error-fallback')
  })

  it('should support React.lazy and dynamic imports', async () => {
    const html = await renderViaHTTP(context.appPort, '/dynamic-imports')
    expect(html).toContain('foo.client')

    const browser = await webdriver(context.appPort, '/dynamic-imports')
    const content = await browser.eval(`window.document.body.innerText`)
    expect(content).toMatchInlineSnapshot('"foo.client"')
  })
}
