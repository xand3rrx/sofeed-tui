import type { AppAction, AppState, Screen } from './types'

export function isEditingScreen(screen: Screen) {
  return screen.kind === 'compose' || screen.kind === 'login' || screen.kind === 'settings'
    || screen.kind === 'account'
    || ((screen.kind === 'search' || screen.kind === 'people') && screen.query === undefined)
}

export const initialState: AppState = { stack: [{ kind: 'feed', feed: 'trending' }] }
export function reducer(state: AppState, action: AppAction): AppState {
  if (action.type === 'push') return { ...state, stack: [...state.stack, action.screen], status: undefined }
  if (action.type === 'replace') {
    return { ...state, stack: [...state.stack.slice(0, -1), action.screen], status: undefined }
  }
  if (action.type === 'back') {
    return state.stack.length > 1
      ? { ...state, stack: state.stack.slice(0, -1), status: undefined }
      : state
  }
  return action.text
    ? { ...state, status: { text: action.text, error: action.error } }
    : { ...state, status: undefined }
}
