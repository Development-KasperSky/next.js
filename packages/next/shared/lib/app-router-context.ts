'use client'

import React from 'react'
import type { FocusAndScrollRef } from '../../client/components/reducer'
import type { FlightRouterState, FlightData } from '../../server/app-render'

export type ChildSegmentMap = Map<string, CacheNode>

// eslint-disable-next-line no-shadow
export enum CacheStates {
  LAZYINITIALIZED = 'LAZYINITIALIZED',
  DATAFETCH = 'DATAFETCH',
  READY = 'READY',
}

/**
 * Cache node used in app-router / layout-router.
 */
export type CacheNode =
  | {
      status: CacheStates.DATAFETCH
      /**
       * In-flight request for this node.
       */
      data: ReturnType<
        typeof import('../../client/components/app-router').fetchServerResponse
      > | null
      head?: React.ReactNode
      /**
       * React Component for this node.
       */
      subTreeData: null
      /**
       * Child parallel routes.
       */
      parallelRoutes: Map<string, ChildSegmentMap>
    }
  | {
      status: CacheStates.READY
      /**
       * In-flight request for this node.
       */
      data: null
      head?: React.ReactNode
      /**
       * React Component for this node.
       */
      subTreeData: React.ReactNode
      /**
       * Child parallel routes.
       */
      parallelRoutes: Map<string, ChildSegmentMap>
    }
  | {
      status: CacheStates.LAZYINITIALIZED
      data: null
      head?: React.ReactNode
      subTreeData: null
      /**
       * Child parallel routes.
       */
      parallelRoutes: Map<string, ChildSegmentMap>
    }
interface NavigateOptions {
  forceOptimisticNavigation?: boolean
}

export interface AppRouterInstance {
  /**
   * Navigate to the previous history entry.
   */
  back(): void
  /**
   * Navigate to the next history entry.
   */
  forward(): void
  /**
   * Refresh the current page.
   */
  refresh(): void
  /**
   * Navigate to the provided href.
   * Pushes a new history entry.
   */
  push(href: string, options?: NavigateOptions): void
  /**
   * Navigate to the provided href.
   * Replaces the current history entry.
   */
  replace(href: string, options?: NavigateOptions): void
  /**
   * Prefetch the provided href.
   */
  prefetch(href: string): void
}

export const AppRouterContext = React.createContext<AppRouterInstance | null>(
  null
)
export const LayoutRouterContext = React.createContext<{
  childNodes: CacheNode['parallelRoutes']
  tree: FlightRouterState
  url: string
}>(null as any)
export const GlobalLayoutRouterContext = React.createContext<{
  tree: FlightRouterState
  changeByServerResponse: (
    previousTree: FlightRouterState,
    flightData: FlightData,
    overrideCanonicalUrl: URL | undefined
  ) => void
  focusAndScrollRef: FocusAndScrollRef
}>(null as any)

export const TemplateContext = React.createContext<React.ReactNode>(null as any)

if (process.env.NODE_ENV !== 'production') {
  AppRouterContext.displayName = 'AppRouterContext'
  LayoutRouterContext.displayName = 'LayoutRouterContext'
  GlobalLayoutRouterContext.displayName = 'GlobalLayoutRouterContext'
  TemplateContext.displayName = 'TemplateContext'
}
