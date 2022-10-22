import { createNext, FileRef } from 'e2e-utils'
import { NextInstance } from 'test/lib/next-modes/base'
import { check, renderViaHTTP } from 'next-test-utils'
import path from 'path'

describe('app-dir edge SSR', () => {
  if ((global as any).isNextDeploy) {
    it('should skip next deploy for now', () => {})
    return
  }

  let next: NextInstance

  beforeAll(async () => {
    next = await createNext({
      files: new FileRef(path.join(__dirname, 'app-edge')),
      dependencies: {
        react: '0.0.0-experimental-9cdf8a99e-20221018',
        'react-dom': '0.0.0-experimental-9cdf8a99e-20221018',
        typescript: 'latest',
        '@types/react': 'latest',
        '@types/node': 'latest',
      },
    })
  })
  afterAll(() => next.destroy())

  it('should handle edge only routes', async () => {
    const appHtml = await renderViaHTTP(next.url, '/app-edge')
    expect(appHtml).toContain('<p>app-edge-ssr</p>')

    const pageHtml = await renderViaHTTP(next.url, '/pages-edge')
    expect(pageHtml).toContain('<p>pages-edge-ssr</p>')
  })

  if ((globalThis as any).isNextDev) {
    it('should handle edge rsc hmr', async () => {
      const pageFile = 'app/app-edge/page.tsx'
      const content = await next.readFile(pageFile)

      // Update rendered content
      const updatedContent = content.replace('app-edge-ssr', 'edge-hmr')
      await next.patchFile(pageFile, updatedContent)
      await check(async () => {
        const html = await renderViaHTTP(next.url, '/app-edge')
        return html
      }, /edge-hmr/)

      // Revert
      await next.patchFile(pageFile, content)
      await check(async () => {
        const html = await renderViaHTTP(next.url, '/app-edge')
        return html
      }, /app-edge-ssr/)
    })
  }
})
