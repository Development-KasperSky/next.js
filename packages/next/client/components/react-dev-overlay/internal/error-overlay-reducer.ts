import type { StackFrame } from 'next/dist/compiled/stacktrace-parser'
import { SupportedErrorEvent } from './container/Errors'

export const ACTION_BUILD_OK = 'build-ok'
export const ACTION_BUILD_ERROR = 'build-error'
export const ACTION_BEFORE_REFRESH = 'before-fast-refresh'
export const ACTION_REFRESH = 'fast-refresh'
export const ACTION_UNHANDLED_ERROR = 'unhandled-error'
export const ACTION_UNHANDLED_REJECTION = 'unhandled-rejection'

interface BuildOkAction {
  type: typeof ACTION_BUILD_OK
}
interface BuildErrorAction {
  type: typeof ACTION_BUILD_ERROR
  message: string
}
interface BeforeFastRefreshAction {
  type: typeof ACTION_BEFORE_REFRESH
}
interface FastRefreshAction {
  type: typeof ACTION_REFRESH
}
export interface UnhandledErrorAction {
  type: typeof ACTION_UNHANDLED_ERROR
  reason: Error
  frames: StackFrame[]
}
export interface UnhandledRejectionAction {
  type: typeof ACTION_UNHANDLED_REJECTION
  reason: Error
  frames: StackFrame[]
}

export type FastRefreshState =
  | {
      type: 'idle'
    }
  | {
      type: 'pending'
      errors: SupportedErrorEvent[]
    }

export interface OverlayState {
  nextId: number
  buildError: string | null
  errors: SupportedErrorEvent[]
  rootLayoutMissingTagsError?: {
    missingTags: string[]
  }
  refreshState: FastRefreshState
}

function pushErrorFilterDuplicates(
  errors: SupportedErrorEvent[],
  err: SupportedErrorEvent
): SupportedErrorEvent[] {
  return [
    ...errors.filter((e) => {
      // Filter out duplicate errors
      return e.event.reason !== err.event.reason
    }),
    err,
  ]
}

export function errorOverlayReducer(
  state: Readonly<OverlayState>,
  action: Readonly<
    | BuildOkAction
    | BuildErrorAction
    | BeforeFastRefreshAction
    | FastRefreshAction
    | UnhandledErrorAction
    | UnhandledRejectionAction
  >
): OverlayState {
  switch (action.type) {
    case ACTION_BUILD_OK: {
      return { ...state, buildError: null }
    }
    case ACTION_BUILD_ERROR: {
      return { ...state, buildError: action.message }
    }
    case ACTION_BEFORE_REFRESH: {
      return { ...state, refreshState: { type: 'pending', errors: [] } }
    }
    case ACTION_REFRESH: {
      return {
        ...state,
        buildError: null,
        errors:
          // Errors can come in during updates. In this case, UNHANDLED_ERROR
          // and UNHANDLED_REJECTION events might be dispatched between the
          // BEFORE_REFRESH and the REFRESH event. We want to keep those errors
          // around until the next refresh. Otherwise we run into a race
          // condition where those errors would be cleared on refresh completion
          // before they can be displayed.
          state.refreshState.type === 'pending'
            ? state.refreshState.errors
            : [],
        refreshState: { type: 'idle' },
      }
    }
    case ACTION_UNHANDLED_ERROR:
    case ACTION_UNHANDLED_REJECTION: {
      switch (state.refreshState.type) {
        case 'idle': {
          return {
            ...state,
            nextId: state.nextId + 1,
            errors: pushErrorFilterDuplicates(state.errors, {
              id: state.nextId,
              event: action,
            }),
          }
        }
        case 'pending': {
          return {
            ...state,
            nextId: state.nextId + 1,
            refreshState: {
              ...state.refreshState,
              errors: pushErrorFilterDuplicates(state.refreshState.errors, {
                id: state.nextId,
                event: action,
              }),
            },
          }
        }
        default:
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const _: never = state.refreshState
          return state
      }
    }
    default: {
      return state
    }
  }
}
