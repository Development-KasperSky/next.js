/* eslint-env jest */

import { join } from 'path'

import {
  File,
  findPort,
  killApp,
  launchApp,
  nextBuild,
  nextStart,
  renderViaHTTP,
  hasRedbox,
  getRedboxHeader,
} from 'next-test-utils'
import blocking from './blocking'
import concurrent from './concurrent'
import basics from './basics'
import strictMode from './strict-mode'
import webdriver from 'next-webdriver'

// overrides react and react-dom to v18
const nodeArgs = ['-r', join(__dirname, 'require-hook.js')]
const appDir = join(__dirname, '../app')
const nextConfig = new File(join(appDir, 'next.config.js'))
const dynamicHello = new File(join(appDir, 'components/dynamic-hello.js'))
const invalidPage = new File(join(appDir, 'pages/invalid.js'))

const USING_CREATE_ROOT = 'Using the createRoot API for React'

async function getBuildOutput(dir) {
  const { stdout, stderr } = await nextBuild(dir, [], {
    stdout: true,
    stderr: true,
    nodeArgs,
  })
  return stdout + stderr
}

async function getDevOutput(dir) {
  const port = await findPort()

  let stdout = ''
  let stderr = ''
  let instance = await launchApp(dir, port, {
    stdout: true,
    stderr: true,
    onStdout(msg) {
      stdout += msg
    },
    onStderr(msg) {
      stderr += msg
    },
    nodeArgs,
  })
  await killApp(instance)
  return stdout + stderr
}

describe('React 18 Support', () => {
  describe('Use legacy render', () => {
    beforeAll(() => {
      nextConfig.replace('reactRoot: true', 'reactRoot: false')
    })
    afterAll(() => {
      nextConfig.restore()
    })

    test('supported version of react in dev', async () => {
      const output = await getDevOutput(appDir)
      expect(output).not.toMatch(USING_CREATE_ROOT)
    })

    test('supported version of react in build', async () => {
      const output = await getBuildOutput(appDir)
      expect(output).not.toMatch(USING_CREATE_ROOT)
    })

    test('suspense is not allowed in blocking rendering mode', async () => {
      nextConfig.replace('withReact18({', '/*withReact18*/({')
      const { stderr, code } = await nextBuild(appDir, [], {
        stderr: true,
      })
      nextConfig.replace('/*withReact18*/({', 'withReact18({')

      expect(stderr).toContain(
        'Invalid suspense option usage in next/dynamic. Read more: https://nextjs.org/docs/messages/invalid-dynamic-suspense'
      )
      expect(code).toBe(1)
    })
  })
})

describe('Basics', () => {
  runTests('default setting with react 18', (context) => basics(context))
})

// React 18 with Strict Mode enabled might cause double invocation of lifecycle methods.
describe('Strict mode - dev', () => {
  const context = { appDir }

  beforeAll(async () => {
    nextConfig.replace('// reactStrictMode: true,', 'reactStrictMode: true,')
    context.appPort = await findPort()
    context.server = await launchApp(context.appDir, context.appPort, {
      nodeArgs,
    })
  })

  afterAll(() => {
    nextConfig.restore()
    killApp(context.server)
  })

  strictMode(context)
})

describe('Blocking mode', () => {
  beforeAll(() => {
    dynamicHello.replace('suspense = false', `suspense = true`)
  })
  afterAll(() => {
    dynamicHello.restore()
  })

  runTests('`runtime` is disabled', (context) => {
    blocking(context, (p, q) => renderViaHTTP(context.appPort, p, q))
  })
})

function runTestsAgainstRuntime(runtime) {
  runTests(
    `Concurrent mode in the ${runtime} runtime`,
    (context, env) => {
      concurrent(context, (p, q) => renderViaHTTP(context.appPort, p, q))

      if (env === 'dev') {
        it('should recover after undefined exported as default', async () => {
          const browser = await webdriver(context.appPort, '/invalid')

          expect(await hasRedbox(browser)).toBe(true)
          expect(await getRedboxHeader(browser)).toMatch(
            `Error: The default export is not a React Component in page: "/invalid"`
          )
        })
      }
    },
    {
      beforeAll: (env) => {
        if (env === 'dev') {
          invalidPage.write(`export const value = 1`)
        }
        nextConfig.replace("// runtime: 'edge'", `runtime: '${runtime}'`)
        dynamicHello.replace('suspense = false', `suspense = true`)
        // `noSSR` mode will be ignored by suspense
        dynamicHello.replace('let ssr', `let ssr = false`)
      },
      afterAll: (env) => {
        if (env === 'dev') {
          invalidPage.delete()
        }
        nextConfig.restore()
        dynamicHello.restore()
      },
    }
  )
}

function runTest(env, name, fn, options) {
  const context = { appDir }
  describe(`${name} (${env})`, () => {
    beforeAll(async () => {
      context.appPort = await findPort()
      context.stderr = ''
      options?.beforeAll(env)
      if (env === 'dev') {
        context.server = await launchApp(context.appDir, context.appPort, {
          nodeArgs,
          onStderr(msg) {
            context.stderr += msg
          },
        })
      } else {
        await nextBuild(context.appDir, [], { nodeArgs })
        context.server = await nextStart(context.appDir, context.appPort, {
          nodeArgs,
          onStderr(msg) {
            context.stderr += msg
          },
        })
      }
    })
    afterAll(async () => {
      options?.afterAll(env)
      await killApp(context.server)
    })
    fn(context, env)
  })
}

runTestsAgainstRuntime('edge')
runTestsAgainstRuntime('nodejs')

function runTests(name, fn, options) {
  runTest('dev', name, fn, options)
  runTest('prod', name, fn, options)
}
