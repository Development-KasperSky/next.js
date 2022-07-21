import type { RequestData, FetchEventResult } from '../types'
import { getServerError } from 'next/dist/compiled/@next/react-dev-overlay/dist/middleware'
import { getModuleContext } from './context'
import { EdgeFunctionDefinition } from '../../../build/webpack/plugins/middleware-plugin'

export const ErrorSource = Symbol('SandboxError')

type RunnerFn = (params: {
  name: string
  env: string[]
  onWarning?: (warn: Error) => void
  paths: string[]
  request: RequestData
  useCache: boolean
  edgeFunctionEntry: Pick<EdgeFunctionDefinition, 'wasm' | 'assets'>
  distDir: string
}) => Promise<FetchEventResult>

export const run = withTaggedErrors(async (params) => {
  const { runtime, evaluateInContext } = await getModuleContext({
    moduleName: params.name,
    onWarning: params.onWarning ?? (() => {}),
    useCache: params.useCache !== false,
    env: params.env,
    edgeFunctionEntry: params.edgeFunctionEntry,
    distDir: params.distDir,
  })

  for (const paramPath of params.paths) {
    evaluateInContext(paramPath)
  }

  const subreq = params.request.headers[`x-middleware-subrequest`]
  const subrequests = typeof subreq === 'string' ? subreq.split(':') : []
  if (subrequests.includes(params.name)) {
    return {
      waitUntil: Promise.resolve(),
      response: new runtime.context.Response(null, {
        headers: {
          'x-middleware-next': '1',
        },
      }),
    }
  }

  return runtime.context._ENTRIES[`middleware_${params.name}`].default({
    request: params.request,
  })
})

/**
 * Decorates the runner function making sure all errors it can produce are
 * tagged with `edge-server` so they can properly be rendered in dev.
 */
function withTaggedErrors(fn: RunnerFn): RunnerFn {
  return (params) =>
    fn(params)
      .then((result) => ({
        ...result,
        waitUntil: result?.waitUntil?.catch((error) => {
          throw getServerError(error, 'edge-server')
        }),
      }))
      .catch((error) => {
        throw getServerError(error, 'edge-server')
      })
}
