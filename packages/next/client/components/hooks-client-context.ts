import { createContext } from 'react'
import { NextParsedUrlQuery } from '../../server/request-meta'

export const QueryContext = createContext<NextParsedUrlQuery>(null as any)
export const PathnameContext = createContext<string>(null as any)
export const ParamsContext = createContext(null as any)
export const LayoutSegmentsContext = createContext(null as any)

if (process.env.NODE_ENV !== 'production') {
  QueryContext.displayName = 'QueryContext'
  PathnameContext.displayName = 'PathnameContext'
  ParamsContext.displayName = 'ParamsContext'
  LayoutSegmentsContext.displayName = 'LayoutSegmentsContext'
}
