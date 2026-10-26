import type { PreloadApi } from '../../../../preload/api-types'
import type { FolderWorkspace } from '../../../../shared/folder-workspace-types'
import type { FolderWorkspacePathStatus } from '../../../../shared/folder-workspace-path-status'
import type {
  ProjectGroup,
  ProjectGroupImportResult,
  NestedRepoScanResult
} from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import {
  callRuntimeResult,
  callRuntimeResultWithOwner,
  withRuntimeRepoOwner
} from './web-runtime-calls'
import { noopUnsubscribe } from './web-storage'

export function createWebFolderWorkspacesApi(): PreloadApi['folderWorkspaces'] {
  return {
    list: async () => {
      const owned = await callRuntimeResultWithOwner<{ folderWorkspaces: FolderWorkspace[] }>(
        'folderWorkspace.list'
      )
      return owned.result.folderWorkspaces.map((row) => ({ ...row, executionHostId: owned.hostId }))
    },
    getPathStatus: async (args) =>
      (
        await callRuntimeResult<{ status: FolderWorkspacePathStatus }>(
          'folderWorkspace.getPathStatus',
          args
        )
      ).status,
    create: async (args) => {
      const owned = await callRuntimeResultWithOwner<{ folderWorkspace: FolderWorkspace }>(
        'folderWorkspace.create',
        args
      )
      return { ...owned.result.folderWorkspace, executionHostId: owned.hostId }
    },
    update: async (args) => {
      const owned = await callRuntimeResultWithOwner<{ folderWorkspace: FolderWorkspace | null }>(
        'folderWorkspace.update',
        args
      )
      return owned.result.folderWorkspace
        ? { ...owned.result.folderWorkspace, executionHostId: owned.hostId }
        : null
    },
    delete: (args) => callRuntimeResult<boolean>('folderWorkspace.delete', args)
  }
}

export function createWebProjectGroupsApi(): PreloadApi['projectGroups'] {
  return {
    list: async () => {
      const owned = await callRuntimeResultWithOwner<{ groups: ProjectGroup[] }>(
        'projectGroup.list'
      )
      return owned.result.groups.map((row) => ({ ...row, executionHostId: owned.hostId }))
    },
    create: async (args) => {
      const owned = await callRuntimeResultWithOwner<{ group: ProjectGroup }>(
        'projectGroup.create',
        args
      )
      return { ...owned.result.group, executionHostId: owned.hostId }
    },
    update: async (args) => {
      const owned = await callRuntimeResultWithOwner<{ group: ProjectGroup | null }>(
        'projectGroup.update',
        args
      )
      return owned.result.group ? { ...owned.result.group, executionHostId: owned.hostId } : null
    },
    delete: (args) => callRuntimeResult<boolean>('projectGroup.delete', args),
    moveProject: async ({ projectId, groupId, order }) => {
      const owned = await callRuntimeResultWithOwner<{ repo: Repo | null }>(
        'projectGroup.moveProject',
        { repo: projectId, groupId, order }
      )
      return owned.result.repo ? withRuntimeRepoOwner(owned.result.repo, owned.hostId) : null
    },
    scanNested: (args) =>
      callRuntimeResult<NestedRepoScanResult>('projectGroup.scanNested', args, 120_000),
    cancelNestedScan: async () => false,
    onNestedScanProgress: () => noopUnsubscribe,
    importNested: async (args) => {
      const owned = await callRuntimeResultWithOwner<ProjectGroupImportResult>(
        'projectGroup.importNested',
        args,
        120_000
      )
      return {
        ...owned.result,
        ...(owned.result.group
          ? { group: { ...owned.result.group, executionHostId: owned.hostId } }
          : {})
      }
    }
  }
}
