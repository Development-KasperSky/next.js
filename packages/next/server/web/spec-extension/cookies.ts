import cookie from 'next/dist/compiled/cookie'
import { CookieSerializeOptions } from '../types'

const normalizeCookieOptions = (options: CookieSerializeOptions) => {
  options = Object.assign({}, options)

  if (options.maxAge) {
    options.expires = new Date(Date.now() + options.maxAge * 1000)
  }

  if (options.path == null) {
    options.path = '/'
  }

  return options
}

const serializeValue = (value: unknown) =>
  typeof value === 'object' ? `j:${JSON.stringify(value)}` : String(value)

const serializeExpiredCookie = (
  key: string,
  options: CookieSerializeOptions = {}
) =>
  cookie.serialize(key, '', {
    expires: new Date(0),
    path: '/',
    ...options,
  })

const deserializeCookie = (input: Request | Response): string[] => {
  const value = input.headers.get('set-cookie')
  return value !== undefined && value !== null ? value.split(', ') : []
}

const serializeCookie = (input: string[]) => input.join(', ')

export class Cookies extends Map<string, any> {
  constructor(input?: string | null) {
    const parsedInput = typeof input === 'string' ? cookie.parse(input) : {}
    super(Object.entries(parsedInput))
  }
  set(key: string, value: unknown, options: CookieSerializeOptions = {}) {
    return super.set(
      key,
      cookie.serialize(
        key,
        serializeValue(value),
        normalizeCookieOptions(options)
      )
    )
  }
}

export class NextCookies extends Cookies {
  response: Request | Response

  constructor(response: Request | Response) {
    super(response.headers.get('cookie'))
    this.response = response
  }
  set = (...args: Parameters<Cookies['set']>) => {
    const isAlreadyAdded = super.has(args[0])
    const store = super.set(...args)

    if (isAlreadyAdded) {
      const setCookie = serializeCookie(
        deserializeCookie(this.response).filter(
          (value) => !value.startsWith(`${args[0]}=`)
        )
      )

      if (setCookie) {
        this.response.headers.set(
          'set-cookie',
          [store.get(args[0]), setCookie].join(', ')
        )
      } else {
        this.response.headers.set('set-cookie', store.get(args[0]))
      }
    } else {
      this.response.headers.append('set-cookie', store.get(args[0]))
    }

    return store
  }
  delete = (key: any, options: CookieSerializeOptions = {}) => {
    const isDeleted = super.delete(key)

    if (isDeleted) {
      const setCookie = serializeCookie(
        deserializeCookie(this.response).filter(
          (value) => !value.startsWith(`${key}=`)
        )
      )
      const expiredCookie = serializeExpiredCookie(key, options)
      this.response.headers.set(
        'set-cookie',
        [expiredCookie, setCookie].join(', ')
      )
    }

    return isDeleted
  }
  clear = (options: CookieSerializeOptions = {}) => {
    const expiredCookies = Array.from(super.keys())
      .map((key) => serializeExpiredCookie(key, options))
      .join(', ')

    if (expiredCookies) this.response.headers.set('set-cookie', expiredCookies)
    return super.clear()
  }
}

export { CookieSerializeOptions }
