// FileTracker's long-path-unsafe .tlog files serve incremental builds; these rebuilds are forced.
export function disableMsbuildFileTrackingOnWindows(
  env = process.env,
  platform = process.platform
) {
  // Windows environment keys are case-insensitive, including caller overrides in copied objects.
  if (
    platform === 'win32' &&
    !Object.keys(env).some((key) => key.toLowerCase() === 'trackfileaccess')
  ) {
    env.TrackFileAccess = 'false'
  }
  // MSBuild still cleans tracking logs with tracking disabled; IntDir already separates projects.
  if (
    platform === 'win32' &&
    !Object.keys(env).some((key) => key.toLowerCase() === 'tloglocation')
  ) {
    env.TLogLocation = '$(IntDir)'
  }
  return env
}
