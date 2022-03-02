/* eslint-env jest */

import { join } from 'path'
import { createNext, FileRef } from 'e2e-utils'
import { NextInstance } from 'test/lib/next-modes/base'
import { renderViaHTTP } from 'next-test-utils'

const appDir = join(__dirname, '../app')

describe('should set-up next', () => {
  let next: NextInstance

  beforeAll(async () => {
    next = await createNext({
      files: {
        pages: new FileRef(join(appDir, 'pages')),
        'tsconfig.json': new FileRef(join(appDir, 'tsconfig.json')),
        'next.config.js': new FileRef(join(appDir, 'next.config.js')),
      },
      dependencies: {
        typescript: 'latest',
        '@types/node': 'latest',
        '@types/react': 'latest',
        '@types/react-dom': 'latest',
      },
    })
  })
  afterAll(() => next.destroy())

  it('should have built and started', async () => {
    const html = await renderViaHTTP(next.url, '/interface/static')
    expect(html).toContain('hello from middleware')
  })
})
