import { createNext, FileRef } from 'e2e-utils'
import { NextInstance } from 'test/lib/next-modes/base'
import path from 'path'
import webdriver from 'next-webdriver'

describe('app-dir back button download bug', () => {
  if ((global as any).isNextDeploy) {
    it('should skip next deploy for now', () => {})
    return
  }

  let next: NextInstance

  beforeAll(async () => {
    next = await createNext({
      files: new FileRef(path.join(__dirname, 'back-button-download-bug')),
      dependencies: {
        react: '0.0.0-experimental-9cdf8a99e-20221018',
        'react-dom': '0.0.0-experimental-9cdf8a99e-20221018',
      },
      skipStart: true,
    })

    await next.start()
  })
  afterAll(() => next.destroy())

  it('should redirect route when clicking link', async () => {
    const browser = await webdriver(next.url, '/')
    const text = await browser
      .elementByCss('#to-post-1')
      .click()
      .waitForElementByCss('#post-page')
      .text()
    expect(text).toBe('This is the post page')

    await browser.back()

    expect(await browser.waitForElementByCss('#home-page').text()).toBe('Home!')
  })
})
