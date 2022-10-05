import { createNext, FileRef } from 'e2e-utils'
import { NextInstance } from 'test/lib/next-modes/base'
import { check } from 'next-test-utils'
import path from 'path'
import webdriver from 'next-webdriver'

describe('vercel analytics', () => {
  const isDev = (global as any).isNextDev

  if ((global as any).isNextDeploy) {
    it('should skip next deploy for now', () => {})
    return
  }

  if (process.env.NEXT_TEST_REACT_VERSION === '^17') {
    it('should skip for react v17', () => {})
    return
  }
  let next: NextInstance

  function runTests({ assetPrefix }: { assetPrefix?: boolean }) {
    beforeAll(async () => {
      next = await createNext({
        files: new FileRef(path.join(__dirname, 'app')),
        dependencies: {
          react: 'experimental',
          'react-dom': 'experimental',
        },
        skipStart: true,
        env: {
          VERCEL_ANALYTICS_ID: 'fake-analytics-id',
        },
      })

      if (assetPrefix) {
        const content = await next.readFile('next.config.js')
        await next.patchFile(
          'next.config.js',
          content
            .replace('// assetPrefix', 'assetPrefix')
            .replace('// beforeFiles', 'beforeFiles')
        )
      }
      await next.start()
    })
    afterAll(() => next.destroy())

    // Analytics events are only sent in production
    ;(isDev ? describe.skip : describe)('Vercel analytics', () => {
      it('should send web vitals to Vercel analytics', async () => {
        let eventsCount = 0
        let countEvents = false
        const browser = await webdriver(next.url, '/client-nested', {
          beforePageLoad(page) {
            page.route(
              'https://vitals.vercel-insights.com/v1/vitals',
              (route) => {
                if (countEvents) {
                  eventsCount += 1
                }

                route.fulfill()
              }
            )
          },
        })

        // Start counting analytics events
        countEvents = true

        // Refresh will trigger CLS and LCP. When page loads FCP and TTFB will trigger:
        await browser.refresh()

        // After interaction LCP and FID will trigger
        await browser.elementByCss('button').click()

        // Make sure all registered events in performance-relayer has fired
        await check(() => eventsCount, /6/)
      })
    })
  }

  describe('without assetPrefix', () => {
    runTests({})
  })

  describe('with assetPrefix', () => {
    runTests({ assetPrefix: true })
  })
})
