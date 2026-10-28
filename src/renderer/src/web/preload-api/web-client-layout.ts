import type { PreloadApi } from '../../../../preload/api-types'
import type { PersistedUIState } from '../../../../shared/persisted-ui-state-types'
import type { PairedUiState } from '../../../../shared/pairing-local-ui-fields'
import { mergeHostWebUIState } from './web-preference-normalization'

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

export function mergeClientLayout(
  local: PersistedUIState,
  incoming: PairedUiState,
  clientLocalLayout: boolean
): PersistedUIState {
  return {
    ...mergeHostWebUIState(local, incoming),
    ...(clientLocalLayout ? readClientLayout(local) : {})
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
