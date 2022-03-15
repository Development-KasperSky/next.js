import { getPageRuntime } from 'next/dist/build/entries'
import { join } from 'path'

const fixtureDir = join(__dirname, 'fixtures')

describe('parse page runtime config', () => {
  it('should parse nodejs runtime correctly', async () => {
    const runtime = await getPageRuntime(
      join(fixtureDir, 'page-runtime/nodejs.js')
    )
    expect(runtime).toBe('nodejs')
  })

  it('should parse edge runtime correctly', async () => {
    const runtime = await getPageRuntime(
      join(fixtureDir, 'page-runtime/edge.js')
    )
    expect(runtime).toBe('edge')
  })

  it('should return undefined if no runtime is specified', async () => {
    const runtime = await getPageRuntime(
      join(fixtureDir, 'page-runtime/static.js')
    )
    expect(runtime).toBe(undefined)
  })
})

describe('fallback to the global runtime configuration', () => {
  it('should fallback when gSP is defined and exported', async () => {
    const runtime = await getPageRuntime(
      join(fixtureDir, 'page-runtime/fallback-with-gsp.js'),
      'edge'
    )
    expect(runtime).toBe('edge')
  })

  it('should fallback when gSP is re-exported from other module', async () => {
    const runtime = await getPageRuntime(
      join(fixtureDir, 'page-runtime/fallback-re-export-gsp.js'),
      'edge'
    )
    expect(runtime).toBe('edge')
  })
})
