#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Install mssql + msnodesqlv8 for CollectRx AbelDent sync on Windows.

.DESCRIPTION
  - Installs Microsoft ODBC Driver 17 for SQL Server (via winget) if missing
  - Runs npm install mssql msnodesqlv8 in the packaged desktop folder

  Run on the practice PC after CollectRx desktop install, or during pilot setup.
#>
param(
  [string]$AppRoot = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
)

$ErrorActionPreference = 'Stop'

Write-Host '[CollectRx] Checking ODBC Driver 17 for SQL Server...'
$odbc = Get-OdbcDriver -Name '*SQL Server*' -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '17|18' }
if (-not $odbc) {
  Write-Host '[CollectRx] Installing ODBC Driver 17 via winget...'
  winget install --id Microsoft.MicrosoftODBCDriver17ForSQLServer -e --accept-package-agreements --accept-source-agreements
} else {
  Write-Host "[CollectRx] Found ODBC driver: $($odbc.Name)"
}

$desktopDir = Join-Path $AppRoot 'desktop'
if (-not (Test-Path $desktopDir)) {
  $desktopDir = Join-Path $AppRoot 'resources' 'app' 'desktop'
}

if (-not (Test-Path $desktopDir)) {
  Write-Warning "[CollectRx] desktop folder not found under $AppRoot — skip npm install"
  exit 0
}

Write-Host "[CollectRx] Installing mssql in $desktopDir ..."
Push-Location $desktopDir
try {
  if (-not (Test-Path 'package.json')) {
    npm init -y | Out-Null
  }
  npm install mssql@11 msnodesqlv8@4 --omit=dev
  Write-Host '[CollectRx] mssql installed successfully.'
} finally {
  Pop-Location
}

Write-Host '[CollectRx] Done. Restart CollectRx desktop and trigger Sync now.'
