import { afterEach, expect, it, vi } from 'vitest'
import { initializeHarmonyClientPreferences } from './client-preferences'
import { installBrowserGlobals } from '../web/web-preload-api-test-harness'
import { SETTINGS_STORAGE_KEY, UI_STORAGE_KEY } from '../web/preload-api/web-storage'
import { UI_LANGUAGE_CHINESE } from '../../../shared/ui-language'

afterEach(() => vi.unstubAllGlobals())

it('initializes a clean client through the normal settings and UI readers', async () => {
  installBrowserGlobals()
  const { getStoredSettings, readLocalWebUIState } =
    await import('../web/preload-api/web-preferences-store')
  initializeHarmonyClientPreferences()
  expect(getStoredSettings()).toMatchObject({
    theme: 'light',
    uiLanguage: UI_LANGUAGE_CHINESE,
    showTasksButton: false,
    showAutomationsButton: false
  })
  expect(readLocalWebUIState()).toMatchObject({
    rightSidebarOpen: false,
    setupGuideSidebarDismissed: true,
    statusBarItems: []
  })
})

it('preserves connection ownership and unrelated preferences while seeding the client', async () => {
  const { storage } = installBrowserGlobals()
  const { readLocalWebUIState } = await import('../web/preload-api/web-preferences-store')
  storage.setItem(
    SETTINGS_STORAGE_KEY,
    JSON.stringify({ activeRuntimeEnvironmentId: 'saved-owner', terminalFontSize: 19 })
  )
  storage.setItem(UI_STORAGE_KEY, JSON.stringify({ sidebarWidth: 320 }))
  initializeHarmonyClientPreferences()
  expect(JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY) ?? '{}')).toMatchObject({
    activeRuntimeEnvironmentId: 'saved-owner',
    terminalFontSize: 19
  })
  expect(readLocalWebUIState().sidebarWidth).toBe(320)
})

it('retains user choices on later launches', async () => {
  const { storage } = installBrowserGlobals()
  const { getStoredSettings, readLocalWebUIState } =
    await import('../web/preload-api/web-preferences-store')
  initializeHarmonyClientPreferences()
  storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ theme: 'dark', showTasksButton: true }))
  storage.setItem(
    UI_STORAGE_KEY,
    JSON.stringify({ rightSidebarOpen: true, statusBarItems: ['ports'] })
  )
  initializeHarmonyClientPreferences()
  expect(getStoredSettings()).toMatchObject({ theme: 'dark', showTasksButton: true })
  expect(readLocalWebUIState()).toMatchObject({
    rightSidebarOpen: true,
    statusBarItems: ['ports']
  })
})
