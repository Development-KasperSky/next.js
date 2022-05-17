import { createNext, FileRef } from 'e2e-utils'
import { NextInstance } from 'test/lib/next-modes/base'
import { renderViaHTTP } from 'next-test-utils'
import path from 'path'

const appDir = path.join(__dirname, 'app')

describe('next/jest', () => {
  let next: NextInstance

  if (process.env.NEXT_TEST_REACT_VERSION === '^17') {
    // react testing library is specific to react version
    it('should bail on react v17', () => {})
    return
  }

  beforeAll(async () => {
    next = await createNext({
      files: {
        pages: new FileRef(path.join(appDir, 'pages')),
        'tests/index.test.js': `
        import { render as renderFn, waitFor } from '@testing-library/react'
        import '@testing-library/jest-dom/extend-expect';

        import Page from '../pages'

        describe('testid', () => {
          it('data-testid should be available in the test', async () => {
            const { getByTestId } = renderFn(
              <Page />
            )
            expect(getByTestId('main-text')).toHaveTextContent('Hello World')
          })
        })
        
        `,
        'jest.config.js': new FileRef(path.join(appDir, 'jest.config.js')),
        'next.config.js': new FileRef(path.join(appDir, 'next.config.js')),
      },
      dependencies: {
        jest: '27.4.7',
        '@testing-library/react': '^13.1.1',
        jsdom: '^19.0.0',
        '@testing-library/jest-dom': '5.16.4',
      },
      packageJson: {
        scripts: {
          // Runs jest and bails if jest fails
          build: 'yarn jest --forceExit tests/index.test.js && yarn next build',
        },
      },
      buildCommand: `yarn build`,
    })
  })
  afterAll(() => next.destroy())

  it('data-testid should be removed in production', async () => {
    const html = await renderViaHTTP(next.appPort, '/')

    expect(html).not.toContain('data-testid')
  })
})
