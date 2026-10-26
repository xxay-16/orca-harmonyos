$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$profilePath = Join-Path $projectRoot 'build-profile.json5'
$localPath = Join-Path $projectRoot 'signing.local.json'
$profile = Get-Content -LiteralPath $profilePath -Raw | ConvertFrom-Json
if (!$profile.app.signingConfigs -or $profile.app.signingConfigs.Count -eq 0) { throw 'No generated signing configuration was found.' }
$local = [pscustomobject]@{ signingConfigs = @($profile.app.signingConfigs) }
[IO.File]::WriteAllText($localPath, ($local | ConvertTo-Json -Depth 30), [Text.UTF8Encoding]::new($false))
$profile.app.signingConfigs = @()
[IO.File]::WriteAllText($profilePath, ($profile | ConvertTo-Json -Depth 30), [Text.UTF8Encoding]::new($false))
Write-Output 'Signing configuration saved to Git-ignored signing.local.json.'
