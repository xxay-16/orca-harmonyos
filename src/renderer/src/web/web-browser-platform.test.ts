import { afterEach, expect, it, vi } from 'vitest'
import { getBrowserPlatform } from './preload-api/web-storage'

afterEach(() => vi.unstubAllGlobals())

it.each([
  ['Mozilla/5.0 (Tablet; OpenHarmony 7.0) ArkWeb/7.0.0.111', 'linux'],
  ['Mozilla/5.0 (Phone; HarmonyOS 6.0) ArkWeb/6.0', 'linux'],
  ['Mozilla/5.0 (X11; Linux x86_64)', 'linux'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'win32'],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'darwin']
])('resolves keyboard platform for %s', (userAgent, platform) => {
  vi.stubGlobal('navigator', { userAgent })
  expect(getBrowserPlatform()).toBe(platform)
})
