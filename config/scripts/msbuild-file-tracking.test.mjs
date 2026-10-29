import { describe, expect, it } from 'vitest'
import { disableMsbuildFileTrackingOnWindows } from './msbuild-file-tracking.mjs'

describe('disableMsbuildFileTrackingOnWindows', () => {
  it('turns tracking off on Windows when the caller left it unset', () => {
    expect(disableMsbuildFileTrackingOnWindows({ PATH: 'x' }, 'win32')).toEqual({
      PATH: 'x',
      TrackFileAccess: 'false',
      TLogLocation: '$(IntDir)'
    })
  })

  it.each(['TrackFileAccess', 'trackfileaccess', 'TRACKFILEACCESS', 'tRaCkFiLeAcCeSs'])(
    'preserves explicit %s values without adding a duplicate key',
    (key) => {
      for (const value of ['true', 'false', '']) {
        const env = { [key]: value, TLogLocation: 'custom\\' }
        expect(disableMsbuildFileTrackingOnWindows(env, 'win32')).toBe(env)
        expect(env).toEqual({ [key]: value, TLogLocation: 'custom\\' })
      }
    }
  )

  it.each(['TLogLocation', 'tloglocation', 'TLOGLOCATION', 'tLoGlOcAtIoN'])(
    "preserves the caller's %s tracking directory",
    (key) => {
      const env = { TrackFileAccess: 'true', [key]: 'custom\\' }
      expect(disableMsbuildFileTrackingOnWindows(env, 'win32')).toEqual({
        TrackFileAccess: 'true',
        [key]: 'custom\\'
      })
      expect(Object.keys(env)).toHaveLength(2)
    }
  )

  it.each(['linux', 'darwin'])('leaves %s hosts alone', (platform) => {
    const env = { PATH: 'x' }
    expect(disableMsbuildFileTrackingOnWindows(env, platform)).toBe(env)
    expect(env).toEqual({ PATH: 'x' })
  })
})
