import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { parse } from 'yaml'
import { runProcessSync } from '@orca/process-host'
import { removeTreeSync } from '../../src/shared/windows-transient-lock-removal.ts'
import { compileAggregateExpression } from './pr-aggregate-gate-context.mjs'

const workflow = (name) => parse(readFileSync(`.github/workflows/${name}.yml`, 'utf8'))
const harmony = workflow('harmonyos')
const desktopFilter = workflow('pr').jobs.code_paths.steps.find((step) => step.id === 'filter')

it('runs the HarmonyOS client on main pushes, ready PRs and manual dispatch', () => {
  expect(harmony.on.push.branches).toEqual(['main'])
  expect(harmony.on.pull_request.paths).toEqual(harmony.on.push.paths)
  expect(harmony.on).toHaveProperty('workflow_dispatch')
  expect(harmony.jobs.renderer.env.ORCA_BACKGROUND_LAUNCH).toBe('1')
  const tests = harmony.jobs.renderer.steps.find((step) => step.name?.startsWith('Test SSH'))
  const paths = tests.run.match(/(?:src|tests)\/[\w./-]+\.test\.[cm]?[jt]sx?/g)
  expect(paths).toEqual(
    expect.arrayContaining([
      'src/renderer/src/harmony/native-bridge.test.ts',
      'src/renderer/src/web/web-preload-api-ui-pairing-local-fields.test.ts',
      'src/renderer/src/components/terminal-pane/xterm-bypass-policy.test.ts'
    ])
  )
  expect(paths.every((path) => existsSync(path))).toBe(true)
  expect(
    harmony.jobs.renderer.steps.find((step) => step.uses?.startsWith('actions/upload-artifact'))
      .with.path
  ).toBe('native/harmonyos/entry/src/main/resources/rawfile/console/')
})

it.each([
  'unit-module-cache',
  'node-next-compat',
  'ci-cache-warmup',
  'ci-cache-warmup-platforms',
  'ci-xterm-cache'
])('keeps the full %s producer manual', (name) =>
  expect(Object.keys(workflow(name).on)).toEqual(['workflow_dispatch'])
)

it.each([
  'e2e',
  'node-server-tests',
  'terminal-perf',
  'terminal-ime-e2e',
  'performance-contracts',
  'wsl-orcad-e2e',
  'packaged-browser-e2e'
])('retains manual %s without a full-suite schedule', (name) => {
  expect(workflow(name).on).toHaveProperty('workflow_dispatch')
  expect(workflow(name).on.schedule).toBeUndefined()
})

it('does not schedule upstream desktop unit shards for a fork PR', () => {
  const enabled = compileAggregateExpression(desktopFilter.env.DESKTOP_CI, ['github'])
  expect(enabled({ github: { repository: 'xxay-16/orca-harmonyos' } }).coerceString()).toBe('false')
  expect(enabled({ github: { repository: 'stablyai/orca' } }).coerceString()).toBe('true')
})

it.skipIf(process.platform === 'win32')(
  'emits the existing no-desktop-work result before requesting a PR diff',
  () => {
    const directory = mkdtempSync(join(tmpdir(), 'orca-harmonyos-ci-'))
    try {
      const output = join(directory, 'output')
      const result = runProcessSync({
        program: 'bash',
        args: ['-e', '-c', desktopFilter.run],
        env: { ...process.env, DESKTOP_CI: 'false', GITHUB_OUTPUT: output }
      })
      expect(result.code, result.stderr).toBe(0)
      expect(readFileSync(output, 'utf8')).toBe('should_run=false\n')
    } finally {
      removeTreeSync(directory)
    }
  }
)
