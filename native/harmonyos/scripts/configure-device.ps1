param(
  [string]$Configuration = '.local/orca-default-ssh.json',
  [Parameter(Mandatory = $true)][string]$Device,
  [string]$DevEcoHome = 'D:\sw\DevEco Studio'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$hdc = Join-Path $DevEcoHome 'sdk/default/openharmony/toolchains/hdc.exe'
$source = if ([IO.Path]::IsPathRooted($Configuration)) { $Configuration } else { Join-Path $projectRoot $Configuration }
if (!(Test-Path -LiteralPath $source)) { throw 'The private device configuration file is missing.' }
$staging = Join-Path $projectRoot '.local/device-import'
New-Item -ItemType Directory -Force -Path $staging | Out-Null
$staged = Join-Path $staging 'orca-default-ssh.json'
Copy-Item -LiteralPath $source -Destination $staged
try {
  $transfer = & $hdc -t $Device file send -b com.xxay16.orcaremote $staged /data/storage/el2/base/files 2>&1
  if ($LASTEXITCODE -ne 0 -or ($transfer -join "`n") -notmatch 'FileTransfer finish') { throw 'Could not provision the application private directory.' }
  & $hdc -t $Device shell aa force-stop com.xxay16.orcaremote
  if ($LASTEXITCODE -ne 0) { throw 'Could not restart the application.' }
  & $hdc -t $Device shell aa start -a EntryAbility -b com.xxay16.orcaremote
  if ($LASTEXITCODE -ne 0) { throw 'Could not launch the application.' }
  Write-Host 'Default SSH configuration delivered to the app for secure import.'
} finally {
  Remove-Item -LiteralPath $staged -Force
}
