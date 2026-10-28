import '../assets/main.css'
import { Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { lazyWithRetry as lazy } from '../lib/lazy-with-retry'
import { installWebPreloadApi } from '../web/web-preload-api'
import { installHarmonyRuntime } from './native-bridge'
import { initializeHarmonyClientPreferences } from './client-preferences'
import { I18nProvider } from '../i18n/I18nProvider'
import { translate } from '../i18n/i18n'
import { useTranslation } from 'react-i18next'
import { RecoverableRenderErrorBoundary } from '../components/error-boundaries/RecoverableRenderErrorBoundary'
import { installAppKeyboardRouter } from '../lib/app-keyboard-router'

const App = lazy(() => import('../App'))

function HarmonyRoot(): React.JSX.Element {
  useTranslation()
  return (
    <RecoverableRenderErrorBoundary
      boundaryId="harmony.root"
      surface="web-root"
      title={translate('app.recoverableError.webTitle', 'Orca web hit a renderer error.')}
      description={translate(
        'app.recoverableError.webDescription',
        'Retry the web client or reconnect to the paired runtime.'
      )}
    >
      <Suspense fallback={<div className="min-h-dvh bg-background" />}>
        <App />
      </Suspense>
    </RecoverableRenderErrorBoundary>
  )
}

function start(): void {
  const root = document.getElementById('root')
  if (!root) {
    throw new Error('Missing app root')
  }
  installHarmonyRuntime()
  initializeHarmonyClientPreferences()
  installWebPreloadApi({ clientLocalLayout: true })
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
      <HarmonyRoot />
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
