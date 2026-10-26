param(
  [string]$DevEcoHome = 'D:\sw\DevEco Studio',
  [switch]$SkipWeb,
  [switch]$Install,
  [string]$Device = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$cliPath = Join-Path $env:APPDATA 'npm\devecocli.cmd'
if (!(Test-Path -LiteralPath $cliPath)) { throw "DevEco CLI was not found: $cliPath" }
if (!(Test-Path -LiteralPath $DevEcoHome)) { throw "DevEco Studio was not found: $DevEcoHome" }
$env:DEVECO_CLI_STUDIO_PATH = $DevEcoHome
$profilePath = Join-Path $projectRoot 'build-profile.json5'
$signingPath = Join-Path $projectRoot 'signing.local.json'
$originalProfile = [IO.File]::ReadAllText($profilePath)
$profileInjected = $false
Push-Location $projectRoot
try {
  if (!(Test-Path -LiteralPath 'third_party/libssh2/CMakeLists.txt') -or !(Test-Path -LiteralPath 'third_party/mbedtls/CMakeLists.txt')) {
    & python scripts/fetch-native.py
    if ($LASTEXITCODE -ne 0) { throw 'Native SSH dependencies could not be prepared.' }
  }
  if (Test-Path -LiteralPath $signingPath) {
    $profile = $originalProfile | ConvertFrom-Json
    $localSigning = Get-Content -LiteralPath $signingPath -Raw | ConvertFrom-Json
    $profile.app.signingConfigs = @($localSigning.signingConfigs)
    [IO.File]::WriteAllText($profilePath, ($profile | ConvertTo-Json -Depth 30), [Text.UTF8Encoding]::new($false))
    $profileInjected = $true
  }
  if (!$SkipWeb) {
    Push-Location (Resolve-Path (Join-Path $projectRoot '../..'))
    try {
      & pnpm run build:harmonyos:web
      if ($LASTEXITCODE -ne 0) { throw 'Web console build failed.' }
    } finally { Pop-Location }
  }
  if (!(Test-Path -LiteralPath 'entry\src\main\resources\rawfile\console\index.html')) {
    throw 'The bundled web console is missing. Build without -SkipWeb first.'
  }
  if ($Install) {
    if ($Device) { & $cliPath run --module entry --device $Device }
    else { & $cliPath run --module entry }
  } else {
    & $cliPath build --modules entry
  }
  if ($LASTEXITCODE -ne 0) { throw 'HarmonyOS build or installation failed.' }
} finally {
  if ($profileInjected) { [IO.File]::WriteAllText($profilePath, $originalProfile, [Text.UTF8Encoding]::new($false)) }
  Pop-Location
}
