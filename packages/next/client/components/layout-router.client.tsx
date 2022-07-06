import React, { useContext } from 'react'
import type { ChildProp } from '../../server/app-render'
import type { ChildSegmentMap } from '../../shared/lib/app-router-context'
import type {
  FlightRouterState,
  FlightSegmentPath,
  FlightDataPath,
} from '../../server/app-render'
import {
  AppTreeContext,
  FullAppTreeContext,
} from '../../shared/lib/app-router-context'
import { fetchServerResponse } from './app-router.client'

let infinitePromise: Promise<void> | Error

function equalArray(a: any[], b: any[]) {
  return a.length === b.length && a.every((val, i) => val === b[i])
}

function pathMatches(
  flightDataPath: FlightDataPath,
  layoutSegmentPath: FlightSegmentPath
): boolean {
  // The last two items are the tree and subTreeData
  const pathToLayout = flightDataPath.slice(0, -3)
  return equalArray(layoutSegmentPath, pathToLayout)
}

function createInfinitePromise() {
  if (!infinitePromise) {
    infinitePromise = new Promise((resolve) => {
      setTimeout(() => {
        infinitePromise = new Error('Infinite promise')
        resolve()
      }, 20000)
    })
  }

  return infinitePromise
}

export function InnerLayoutRouter({
  parallelRouterKey,
  url,
  childNodes,
  childProp,
  segmentPath,
  tree,
  // isActive,
  path,
}: {
  parallelRouterKey: string
  url: string
  childNodes: ChildSegmentMap
  childProp: ChildProp | null
  segmentPath: FlightSegmentPath
  tree: FlightRouterState
  isActive: boolean
  path: string
}) {
  const { changeByServerResponse, tree: fullTree } =
    useContext(FullAppTreeContext)

  let childNode = childNodes.get(path)

  if (childProp && !childNode) {
    childNodes.set(path, {
      data: null,
      subTreeData: childProp.current,
      parallelRoutes: new Map([[parallelRouterKey, new Map()]]),
    })
    childProp.current = null
    // In the above case childNode was set on childNodes, so we have to get it from the cacheNodes again.
    childNode = childNodes.get(path)
  }

  if (!childNode) {
    const walkAddRefetch = (
      segmentPathToWalk: FlightSegmentPath | undefined,
      treeToRecreate: FlightRouterState
    ): FlightRouterState => {
      if (segmentPathToWalk) {
        const [segment, parallelRouteKey] = segmentPathToWalk
        const isLast = segmentPathToWalk.length === 2

        if (treeToRecreate[0] === segment) {
          if (treeToRecreate[1].hasOwnProperty(parallelRouteKey)) {
            if (isLast) {
              const subTree = walkAddRefetch(
                undefined,
                treeToRecreate[1][parallelRouteKey]
              )
              if (!subTree[2]) {
                subTree[2] = undefined
              }
              subTree[3] = 'refetch'
              return [
                treeToRecreate[0],
                {
                  ...treeToRecreate[1],
                  [parallelRouteKey]: [...subTree],
                },
              ]
            }

            return [
              treeToRecreate[0],
              {
                ...treeToRecreate[1],
                [parallelRouteKey]: walkAddRefetch(
                  segmentPathToWalk.slice(2),
                  treeToRecreate[1][parallelRouteKey]
                ),
              },
            ]
          }
        }
      }

      return treeToRecreate
    }

    // TODO: remove ''
    const refetchTree = walkAddRefetch(['', ...segmentPath], fullTree)

    const data = fetchServerResponse(new URL(url, location.origin), refetchTree)
    childNodes.set(path, {
      data,
      subTreeData: null,
      parallelRoutes: new Map([[parallelRouterKey, new Map()]]),
    })
    // In the above case childNode was set on childNodes, so we have to get it from the cacheNodes again.
    childNode = childNodes.get(path)
  }

  // In the above case childNode was set on childNodes, so we have to get it from the cacheNodes again.
  childNode = childNodes.get(path)

  if (!childNode) {
    throw new Error('Child node should always exist')
  }

  if (childNode.subTreeData && childNode.data) {
    throw new Error('Child node should not have both subTreeData and data')
  }

  if (childNode.data) {
    // TODO: error case
    const flightData = childNode.data.readRoot()

    // Handle case when navigating to page in `pages` from `app`
    if (typeof flightData === 'string') {
      window.location.href = url
      return null
    }

    let fastPath: boolean = false
    // segmentPath matches what came back from the server. This is the happy path.
    if (flightData.length === 1) {
      const flightDataPath = flightData[0]

      if (pathMatches(flightDataPath, segmentPath)) {
        childNode.data = null
        // Last item is the subtreeData
        // TODO: routerTreePatch needs to be applied to the tree, handle it in render?
        const [, /* routerTreePatch */ subTreeData] = flightDataPath.slice(-2)
        childNode.subTreeData = subTreeData
        childNode.parallelRoutes = new Map()
        fastPath = true
      }
    }

    if (!fastPath) {
      // For push we can set data in the cache

      // segmentPath from the server does not match the layout's segmentPath
      childNode.data = null

      setTimeout(() => {
        // @ts-ignore startTransition exists
        React.startTransition(() => {
          // TODO: handle redirect
          changeByServerResponse(fullTree, flightData)
        })
      })
      // Suspend infinitely as `changeByServerResponse` will cause a different part of the tree to be rendered.
      throw createInfinitePromise()
    }
  }

  // TODO: double check users can't return null in a component that will kick in here
  if (!childNode.subTreeData) {
    throw createInfinitePromise()
  }

  return (
    <AppTreeContext.Provider
      value={{
        tree: tree[1][parallelRouterKey],
        childNodes: childNode.parallelRoutes,
        // TODO: overriding of url for parallel routes
        url: url,
      }}
    >
      {childNode.subTreeData}
    </AppTreeContext.Provider>
  )
}

function LoadingBoundary({
  children,
  loading,
}: {
  children: React.ReactNode
  loading?: React.ReactNode
}) {
  if (loading) {
    return <React.Suspense fallback={loading}>{children}</React.Suspense>
  }

  return <>{children}</>
}

export default function OuterLayoutRouter({
  parallelRouterKey,
  segmentPath,
  childProp,
  loading,
}: {
  parallelRouterKey: string
  segmentPath: FlightSegmentPath
  childProp: ChildProp
  loading: React.ReactNode | undefined
}) {
  const { childNodes, tree, url } = useContext(AppTreeContext)

  let childNodesForParallelRouter = childNodes.get(parallelRouterKey)
  if (!childNodesForParallelRouter) {
    childNodes.set(parallelRouterKey, new Map())
    childNodesForParallelRouter = childNodes.get(parallelRouterKey)!
  }

  // This relates to the segments in the current router
  // tree[1].children[0] refers to tree.children.segment in the data format
  const currentChildSegment = tree[1][parallelRouterKey][0] ?? childProp.segment
  const preservedSegments: string[] = [currentChildSegment]

  return (
    <>
      {preservedSegments.map((preservedSegment) => {
        return (
          <LoadingBoundary loading={loading} key={preservedSegment}>
            <InnerLayoutRouter
              parallelRouterKey={parallelRouterKey}
              url={url}
              tree={tree}
              childNodes={childNodesForParallelRouter!}
              childProp={
                childProp.segment === preservedSegment ? childProp : null
              }
              segmentPath={segmentPath}
              path={preservedSegment}
              isActive={currentChildSegment === preservedSegment}
            />
          </LoadingBoundary>
        )
      })}
    </>
  )
}
