import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { parse } from 'yaml'
import { compileAggregateExpression } from './pr-aggregate-gate-context.mjs'

const workflow = (name) => parse(readFileSync(`.github/workflows/${name}.yml`, 'utf8'))
const evaluate = (expression, context) =>
  compileAggregateExpression(expression, ['github', 'inputs', 'runner'])(context)

it.each(['xxay-16/orca-harmonyos', 'another-owner/orca'])(
  'seeds only usable hosted cache pools for %s',
  (repository) => {
    const platforms = workflow('ci-cache-warmup-platform-jobs').jobs
    for (const [job, hosted, upstream] of [
      [
        workflow('ci-cache-warmup').jobs.warm,
        ['ubuntu-24.04'],
        ['blacksmith-4vcpu-ubuntu-2404', 'ubuntu-24.04']
      ],
      [
        platforms['warm-linux-runtime'],
        ['ubuntu-24.04-arm', 'ubuntu-22.04'],
        [
          'blacksmith-4vcpu-ubuntu-2404-arm',
          'blacksmith-8vcpu-ubuntu-2404',
          'ubuntu-24.04-arm',
          'ubuntu-22.04'
        ]
      ],
      [
        platforms['warm-linux-package-fixtures'],
        ['ubuntu-24.04'],
        ['blacksmith-4vcpu-ubuntu-2404', 'ubuntu-24.04']
      ],
      [
        workflow('ci-xterm-cache').jobs.seed,
        ['ubuntu-24.04-arm'],
        ['blacksmith-4vcpu-ubuntu-2404-arm', 'ubuntu-24.04-arm']
      ]
    ]) {
      for (const [repo, expected] of [
        [repository, hosted],
        ['stablyai/orca', upstream]
      ]) {
        expect(
          evaluate(job.strategy.matrix.runner, { github: { repository: repo } })
            .values()
            .map((item) => item.value)
        ).toEqual(expected)
      }
    }
  }
)

it.each([
  ['blacksmith-4vcpu-ubuntu-2404', 'ubuntu-24.04'],
  ['blacksmith-8vcpu-ubuntu-2404', 'ubuntu-24.04'],
  ['blacksmith-4vcpu-ubuntu-2404-arm', 'ubuntu-24.04-arm'],
  ['windows-2022', 'windows-2022'],
  ['macos-15', 'macos-15']
])('routes reusable units from %s to %s on a fork', (requested, hosted) => {
  const expression = workflow('unit-tests').jobs.test['runs-on']
  for (const [repository, expected] of [
    ['stablyai/orca', requested],
    ['xxay-16/orca-harmonyos', hosted]
  ]) {
    expect(
      evaluate(expression, { github: { repository }, inputs: { runner: requested } }).coerceString()
    ).toBe(expected)
  }
})

it('runs fork preflight, terminal performance and Linux E2E on hosted runners', () => {
  const jobs = [
    workflow('pr').jobs.preflight,
    workflow('pr').jobs.git_compatibility,
    workflow('terminal-perf').jobs['terminal-perf'],
    ...Object.values(workflow('e2e').jobs).filter((job) => job['runs-on']?.includes('blacksmith-'))
  ]
  expect(jobs.length).toBeGreaterThan(3)
  for (const job of jobs) {
    expect(
      evaluate(job['runs-on'], { github: { repository: 'xxay-16/orca-harmonyos' } }).coerceString()
    ).toBe('ubuntu-24.04')
    expect(
      evaluate(job['runs-on'], { github: { repository: 'stablyai/orca' } }).coerceString()
    ).toMatch(/^blacksmith-/)
  }
})

it('caps hosted unit workers when the caller requested an eight-core Blacksmith pool', () => {
  const step = workflow('unit-tests').jobs.test.steps.find((step) => step.name === 'Test shard')
  const expression = [...step.run.matchAll(/\$\{\{(.+?)\}\}/g)].find((match) =>
    match[1].includes('--maxWorkers')
  )[1]
  expect(
    evaluate(expression, {
      github: { repository: 'xxay-16/orca-harmonyos' },
      inputs: { runner: 'blacksmith-8vcpu-ubuntu-2404' },
      runner: { arch: 'X64', environment: 'github-hosted' }
    }).coerceString()
  ).toBe('--maxWorkers=4')
})

it('serializes the real Git matrix on fork runners while retaining upstream parallelism', () => {
  const step = workflow('pr').jobs.git_compatibility.steps.find(
    (step) => step.name === 'Verify Git binary compatibility matrix'
  )
  for (const [repository, expected] of [
    ['stablyai/orca', 'true'],
    ['xxay-16/orca-harmonyos', 'false']
  ]) {
    expect(
      evaluate(step.env.ORCA_GIT_COMPAT_PARALLEL, { github: { repository } }).coerceString()
    ).toBe(expected)
  }
})
