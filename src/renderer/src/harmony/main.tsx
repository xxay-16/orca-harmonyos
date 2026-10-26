import '../assets/main.css'
import { Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { lazyWithRetry as lazy } from '../lib/lazy-with-retry'
import { installWebPreloadApi } from '../web/web-preload-api'
import { installHarmonyRuntime } from './native-bridge'
import {
  getStoredSettings,
  writeStoredSettings,
  readLocalWebUIState
} from '../web/preload-api/web-preferences-store'
import { UI_STORAGE_KEY, writeJson } from '../web/preload-api/web-storage'
import { UI_LANGUAGE_CHINESE } from '../../../shared/ui-language'
import { I18nProvider } from '../i18n/I18nProvider'
import { RecoverableRenderErrorBoundary } from '../components/error-boundaries/RecoverableRenderErrorBoundary'
import { installAppKeyboardRouter } from '../lib/app-keyboard-router'

const App = lazy(() => import('../App'))

function start(): void {
  const root = document.getElementById('root')
  if (!root) {
    throw new Error('Missing app root')
  }
  installHarmonyRuntime()
  installWebPreloadApi({ clientLocalLayout: true })
  if (!window.localStorage.getItem('orca.harmony.preferences.v4')) {
    writeStoredSettings({
      ...getStoredSettings(),
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
      ...readLocalWebUIState(),
      rightSidebarOpen: false,
      setupGuideSidebarDismissed: true,
      statusBarItems: []
    })
    window.localStorage.setItem('orca.harmony.preferences.v4', '1')
  }
  const updateAppearance = () =>
    window.OrcaNative?.setColorScheme?.(
      document.documentElement.classList.contains('dark') ? 'dark' : 'light'
    )
  new MutationObserver(updateAppearance).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class']
  })
  updateAppearance()
  installAppKeyboardRouter()
  ReactDOM.createRoot(root).render(
    <I18nProvider>
      <RecoverableRenderErrorBoundary
        boundaryId="harmony.root"
        surface="web-root"
        title="页面加载失败"
        description="请重新打开应用后重试。"
      >
        <Suspense fallback={<div className="min-h-dvh bg-background" />}>
          <App />
        </Suspense>
      </RecoverableRenderErrorBoundary>
    </I18nProvider>
  )
}

try {
  start()
} catch (error) {
  const root = document.getElementById('root')
  if (root) {
    root.textContent = error instanceof Error ? error.message : '应用启动失败，请检查连接配置。'
  }
}
