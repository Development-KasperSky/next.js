/* eslint-env jest */

import { Blob, File, FormData } from 'next/dist/compiled/formdata-node'
import { Crypto } from 'next/dist/server/web/sandbox/polyfills'
import { Response } from 'next/dist/server/web/spec-compliant/response'
import { Headers } from 'next/dist/server/web/spec-compliant/headers'
import * as streams from 'web-streams-polyfill/ponyfill'

beforeAll(() => {
  global['Blob'] = Blob
  global['crypto'] = new Crypto()
  global['File'] = File
  global['FormData'] = FormData
  global['Headers'] = Headers
  global['ReadableStream'] = streams.ReadableStream
  global['TransformStream'] = streams.TransformStream
  global['Response'] = Response
})

afterAll(() => {
  delete global['Blob']
  delete global['crypto']
  delete global['File']
  delete global['Headers']
  delete global['FormData']
  delete global['ReadableStream']
  delete global['TransformStream']
})

it('reflect .set into `set-cookie`', async () => {
  const { NextResponse } = await import(
    'next/dist/server/web/spec-extension/response'
  )

  const response = new NextResponse()

  expect(response.cookies.get('foo')).toBe(undefined)
  expect(response.cookies.getWithOptions('foo')).toEqual({
    value: undefined,
    options: {},
  })

  response.cookies
    .set('foo', 'bar', { path: '/test' })
    .set('fooz', 'barz', { path: '/test2' })

  expect(response.cookies.get('foo')).toBe('bar')
  expect(response.cookies.get('fooz')).toBe('barz')

  expect(response.cookies.getWithOptions('foo')).toEqual({
    value: 'bar',
    options: { Path: '/test' },
  })
  expect(response.cookies.getWithOptions('fooz')).toEqual({
    value: 'barz',
    options: { Path: '/test2' },
  })

  expect(Object.fromEntries(response.headers.entries())['set-cookie']).toBe(
    'foo=bar; Path=/test, fooz=barz; Path=/test2'
  )
})

it('reflect .delete into `set-cookie`', async () => {
  const { NextResponse } = await import(
    'next/dist/server/web/spec-extension/response'
  )

  const response = new NextResponse()

  response.cookies.set('foo', 'bar')
  expect(Object.fromEntries(response.headers.entries())['set-cookie']).toBe(
    'foo=bar; Path=/'
  )

  expect(response.cookies.get('foo')).toBe('bar')
  expect(response.cookies.getWithOptions('foo')).toEqual({
    value: 'bar',
    options: { Path: '/' },
  })

  response.cookies.set('fooz', 'barz')
  expect(Object.fromEntries(response.headers.entries())['set-cookie']).toBe(
    'foo=bar; Path=/, fooz=barz; Path=/'
  )

  expect(response.cookies.get('fooz')).toBe('barz')
  expect(response.cookies.getWithOptions('fooz')).toEqual({
    value: 'barz',
    options: { Path: '/' },
  })

  const firstDelete = response.cookies.delete('foo')
  expect(firstDelete).toBe(true)
  expect(Object.fromEntries(response.headers.entries())['set-cookie']).toBe(
    'foo=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT, fooz=barz; Path=/'
  )

  expect(response.cookies.get('foo')).toBe(undefined)
  expect(response.cookies.getWithOptions('foo')).toEqual({
    value: undefined,
    options: {},
  })

  const secondDelete = response.cookies.delete('fooz')
  expect(secondDelete).toBe(true)

  expect(Object.fromEntries(response.headers.entries())['set-cookie']).toBe(
    'fooz=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT, foo=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
  )

  expect(response.cookies.get('fooz')).toBe(undefined)
  expect(response.cookies.getWithOptions('fooz')).toEqual({
    value: undefined,
    options: {},
  })
  expect(response.cookies.size).toBe(0)
})

it('reflect .clear into `set-cookie`', async () => {
  const { NextResponse } = await import(
    'next/dist/server/web/spec-extension/response'
  )

  const response = new NextResponse()

  response.cookies.clear()
  expect(Object.fromEntries(response.headers.entries())['set-cookie']).toBe(
    undefined
  )

  response.cookies.set('foo', 'bar')
  expect(Object.fromEntries(response.headers.entries())['set-cookie']).toBe(
    'foo=bar; Path=/'
  )

  expect(response.cookies.get('foo')).toBe('bar')
  expect(response.cookies.getWithOptions('foo')).toEqual({
    value: 'bar',
    options: { Path: '/' },
  })

  response.cookies.set('fooz', 'barz')
  expect(Object.fromEntries(response.headers.entries())['set-cookie']).toBe(
    'foo=bar; Path=/, fooz=barz; Path=/'
  )

  response.cookies.clear()
  expect(Object.fromEntries(response.headers.entries())['set-cookie']).toBe(
    'foo=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT, fooz=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
  )
})

it('response.cookie does not modify options', async () => {
  const { NextResponse } = await import(
    'next/dist/server/web/spec-extension/response'
  )

  const options = { maxAge: 10000 }
  const response = NextResponse.json(null)
  response.cookies.set('cookieName', 'cookieValue', options)
  expect(options).toEqual({ maxAge: 10000 })
})
