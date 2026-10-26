import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import {
  installBrowserGlobals,
  writeStoredRuntimeEnvironment
} from './web-preload-api-test-harness'

const runtimeClient = vi.hoisted(() => ({
  call: vi.fn<(method: string, params?: unknown) => Promise<RuntimeRpcResponse<unknown>>>()
}))
vi.mock('./web-runtime-client', () => ({
  WebRuntimeClient: class {
    call = runtimeClient.call
    close(): void {}
  }
}))

describe('paired web folder workspace APIs', () => {
  afterEach(async () => {
    const { removeActiveRuntimeEnvironment } = await import('./preload-api/web-runtime-session')
    removeActiveRuntimeEnvironment()
    runtimeClient.call.mockReset()
    vi.unstubAllGlobals()
  })

  async function install() {
    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage)
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()
    return { api: globals.window.api }
  }

  it('loads folder catalogs through RPC and keeps their execution host', async () => {
    runtimeClient.call.mockImplementation(async (method) => ({
      id: method,
      ok: true,
      _meta: { runtimeId: 'runtime-1' },
      result:
        method === 'projectGroup.list'
          ? { groups: [{ id: 'group-1', name: 'Remote folders' }] }
          : {
              folderWorkspaces: [
                { id: 'folder-1', projectGroupId: 'group-1', folderPath: '/srv/plain-folder' }
              ]
            }
    }))
    const { api } = await install()
    await expect(api.projectGroups.list()).resolves.toMatchObject([
      { id: 'group-1', executionHostId: 'runtime:web-env-1' }
    ])
    await expect(api.folderWorkspaces.list()).resolves.toMatchObject([
      { id: 'folder-1', folderPath: '/srv/plain-folder', executionHostId: 'runtime:web-env-1' }
    ])
    expect(runtimeClient.call.mock.calls.map(([method]) => method)).toEqual([
      'projectGroup.list',
      'folderWorkspace.list'
    ])
  })

  it('passes folder mutations to their canonical RPC and preserves missing-row results', async () => {
    runtimeClient.call.mockImplementation(async (method) => ({
      id: method,
      ok: true,
      _meta: { runtimeId: 'runtime-1' },
      result:
        method === 'folderWorkspace.create'
          ? {
              folderWorkspace: {
                id: 'folder-new',
                projectGroupId: 'group-1',
                folderPath: '/srv/plain-folder'
              }
            }
          : { folderWorkspace: null }
    }))
    const { api } = await install()
    const args = {
      projectGroupId: 'group-1',
      folderPath: '/srv/plain-folder',
      name: 'Plain folder'
    }
    await expect(api.folderWorkspaces.create(args)).resolves.toMatchObject({
      id: 'folder-new',
      executionHostId: 'runtime:web-env-1'
    })
    expect(runtimeClient.call.mock.calls[0]?.slice(0, 2)).toEqual(['folderWorkspace.create', args])
    await expect(
      api.folderWorkspaces.update({ folderWorkspaceId: 'missing', updates: { name: 'New name' } })
    ).resolves.toBeNull()
  })
})
