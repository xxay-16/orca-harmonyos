import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { PersistedUIState } from '../../../shared/persisted-ui-state-types'
import { UI_LANGUAGE_CHINESE } from '../../../shared/ui-language'
import {
  SETTINGS_STORAGE_KEY,
  UI_STORAGE_KEY,
  readJson,
  writeJson
} from '../web/preload-api/web-storage'

const INITIALIZED_KEY = 'orca.harmony.preferences.v4'

export function initializeHarmonyClientPreferences(): void {
  if (window.localStorage.getItem(INITIALIZED_KEY)) {
    return
  }
  writeJson(SETTINGS_STORAGE_KEY, {
    ...readJson<Partial<GlobalSettings>>(SETTINGS_STORAGE_KEY, {}),
    theme: 'light',
    uiLanguage: UI_LANGUAGE_CHINESE,
    showTasksButton: false,
    showAutomationsButton: false,
    showArtifactsButton: false,
    showSkillsButton: false,
    showMobileButton: false,
    showTitlebarAppName: false
  })
  writeJson(UI_STORAGE_KEY, {
    ...readJson<Partial<PersistedUIState>>(UI_STORAGE_KEY, {}),
    rightSidebarOpen: false,
    setupGuideSidebarDismissed: true,
    statusBarItems: []
  })
  window.localStorage.setItem(INITIALIZED_KEY, '1')
}
