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
    const path500HTML = await renderViaHTTP(context.appPort, '/err')

    if (env === 'dev') {
      // In dev mode it should show the error popup.
      expect(path500HTML).toContain('Error: oops')
    } else {
      expect(path500HTML).toContain('custom-500-page')
    }
  })
}
