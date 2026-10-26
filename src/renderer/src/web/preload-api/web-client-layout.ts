import type { PreloadApi } from '../../../../preload/api-types'
import type { PersistedUIState } from '../../../../shared/persisted-ui-state-types'

type LayoutFields = Pick<
  PersistedUIState,
  | 'rightSidebarOpen'
  | 'rightSidebarWidth'
  | 'sidebarWidth'
  | 'setupGuideSidebarDismissed'
  | 'statusBarItems'
>

export function readClientLayout(state: PersistedUIState): LayoutFields {
  return {
    rightSidebarOpen: state.rightSidebarOpen,
    rightSidebarWidth: state.rightSidebarWidth,
    sidebarWidth: state.sidebarWidth,
    setupGuideSidebarDismissed: state.setupGuideSidebarDismissed,
    statusBarItems: state.statusBarItems
  }
}

export function omitClientLayout(updates: Parameters<PreloadApi['ui']['set']>[0]) {
  const {
    rightSidebarOpen: _rightOpen,
    rightSidebarWidth: _rightWidth,
    sidebarWidth: _leftWidth,
    setupGuideSidebarDismissed: _guide,
    statusBarItems: _statusItems,
    ...nonLayoutUpdates
  } = updates
  return nonLayoutUpdates
}
