import { createNext, FileRef } from 'e2e-utils'
import { NextInstance } from 'test/lib/next-modes/base'
import { check } from 'next-test-utils'
import { join } from 'path'
import webdriver from 'next-webdriver'

describe('reload-scroll-back-restoration', () => {
  let next: NextInstance

  beforeAll(async () => {
    next = await createNext({
      files: {
        pages: new FileRef(join(__dirname, 'pages')),
        'next.config.js': new FileRef(join(__dirname, 'next.config.js')),
      },
      dependencies: {},
    })
  })
  afterAll(() => next.destroy())

  it('should restore the scroll position on navigating back', async () => {
    const browser = await webdriver(next.url, '/0')
    await browser.eval(() => document.querySelector('#link').scrollIntoView())

    // check browser restoration setting
    const scrollRestoration = await browser.eval(
      () => window.history.scrollRestoration
    )
    expect(scrollRestoration).toBe('manual')

    const scrollPositionMemories: Array<{ x: number; y: number }> = []
    scrollPositionMemories.push({
      x: Math.floor(await browser.eval(() => window.scrollX)),
      y: Math.floor(await browser.eval(() => window.scrollY)),
    })

    // check initial value
    expect(scrollPositionMemories[0].x).not.toBe(0)
    expect(scrollPositionMemories[0].y).not.toBe(0)

    await browser.eval(`window.next.router.push('/1')`)
    await browser.eval(() => document.querySelector('#link').scrollIntoView())
    scrollPositionMemories.push({
      x: Math.floor(await browser.eval(() => window.scrollX)),
      y: Math.floor(await browser.eval(() => window.scrollY)),
    })
    await browser.eval(`window.next.router.push('/2')`)

    // check restore value on history index: 1
    await browser.back()
    await check(
      () => browser.eval(() => document.documentElement.innerHTML),
      /routeChangeComplete/
    )

    expect(scrollPositionMemories[1].x).toBe(
      Math.floor(await browser.eval(() => window.scrollX))
    )
    expect(scrollPositionMemories[1].y).toBe(
      Math.floor(await browser.eval(() => window.scrollY))
    )

    await browser.refresh()

    // check restore value on history index: 0
    await browser.back()
    await check(
      () => browser.eval(() => document.documentElement.innerHTML),
      /routeChangeComplete/
    )

    expect(scrollPositionMemories[0].x).toBe(
      Math.floor(await browser.eval(() => window.scrollX))
    )
    expect(scrollPositionMemories[0].y).toBe(
      Math.floor(await browser.eval(() => window.scrollY))
    )
  })

  it('should restore the scroll position on navigating forward', async () => {
    const browser = await webdriver(next.url, '/0')
    await browser.eval(() => document.querySelector('#link').scrollIntoView())

    // check browser restoration setting
    const scrollRestoration = await browser.eval(
      () => window.history.scrollRestoration
    )
    expect(scrollRestoration).toBe('manual')

    const scrollPositionMemories: Array<{ x: number; y: number }> = []
    scrollPositionMemories.push({
      x: Math.floor(await browser.eval(() => window.scrollX)),
      y: Math.floor(await browser.eval(() => window.scrollY)),
    })

    // check initial value
    expect(scrollPositionMemories[0].x).not.toBe(0)
    expect(scrollPositionMemories[0].y).not.toBe(0)

    await browser.eval(`window.next.router.push('/1')`)
    await browser.eval(() => document.querySelector('#link').scrollIntoView())
    scrollPositionMemories.push({
      x: Math.floor(await browser.eval(() => window.scrollX)),
      y: Math.floor(await browser.eval(() => window.scrollY)),
    })
    await browser.eval(`window.next.router.push('/2')`)
    await browser.eval(() => document.querySelector('#link').scrollIntoView())
    scrollPositionMemories.push({
      x: Math.floor(await browser.eval(() => window.scrollX)),
      y: Math.floor(await browser.eval(() => window.scrollY)),
    })

    // check restore value on history index: 1
    await browser.back()
    await browser.back()
    await browser.forward()
    await check(
      () => browser.eval(() => document.documentElement.innerHTML),
      /routeChangeComplete/
    )

    expect(scrollPositionMemories[1].x).toBe(
      Math.floor(await browser.eval(() => window.scrollX))
    )
    expect(scrollPositionMemories[1].y).toBe(
      Math.floor(await browser.eval(() => window.scrollY))
    )

    await browser.refresh()

    // check restore value on history index: 2
    await browser.forward()
    await check(
      () => browser.eval(() => document.documentElement.innerHTML),
      /routeChangeComplete/
    )

    expect(scrollPositionMemories[2].x).toBe(
      Math.floor(await browser.eval(() => window.scrollX))
    )
    expect(scrollPositionMemories[2].y).toBe(
      Math.floor(await browser.eval(() => window.scrollY))
    )
  })
})
