param(
  [string]$Project,
  [string]$OutDir
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not $Project) {
  $Project = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

if (-not $OutDir) {
  $OutDir = Split-Path $Project -Parent
}

function Test-Zip([string]$ZipPath) {
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
    [System.IO.Compression.ZipFile]::OpenRead($ZipPath).Dispose()
    return $true
  } catch {
    return $false
  }
}

function New-StagingCopy(
  [string]$Source,
  [string]$Destination,
  [string[]]$ExcludeDirs
) {
  if (Test-Path $Destination) { Remove-Item $Destination -Recurse -Force }
  New-Item -ItemType Directory -Path $Destination | Out-Null

  $rcArgs = @($Source, $Destination, "/MIR", "/R:1", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/NP")
  foreach ($dir in $ExcludeDirs) {
    $rcArgs += @("/XD", (Join-Path $Source $dir))
  }

  $robolog = robocopy @rcArgs
  $code = $LASTEXITCODE
  Write-Host $robolog
  if ($code -gt 7) { throw "Robocopy falló (código $code)" }
}

function Remove-SensitiveFiles([string]$Root) {
  $blockedNames = @(
    ".env",
    ".env.local",
    ".env.production",
    ".env.development",
    ".env.txt",
    ".coverage",
    "coverage.xml"
  )
  $blockedExtensions = @(
    ".sqlite3",
    ".db",
    ".pem",
    ".key",
    ".p12",
    ".pfx",
    ".jks",
    ".keystore",
    ".mobileprovision",
    ".log",
    ".zip"
  )
  $blockedSuffixes = @(
    ".sqlite3-shm",
    ".sqlite3-wal",
    ".sqlite3-journal",
    ".db-shm",
    ".db-wal",
    ".db-journal"
  )

  Get-ChildItem $Root -Recurse -Force | Where-Object {
    $_.PSIsContainer -and $_.Name -in @(".pytest_cache", "__pycache__")
  } | Remove-Item -Recurse -Force

  Get-ChildItem $Root -Recurse -File -Force | Where-Object {
    $fullName = $_.FullName
    $isNonExampleDotEnv = $_.Name -like ".env.*" -and $_.Name -ne ".env.example"
    ($_.DirectoryName -eq (Join-Path $Root "backend") -and $_.Name -eq ".env") -or
    $isNonExampleDotEnv -or
    $_.Name -in $blockedNames -or
    $_.Extension -in $blockedExtensions -or
    ($blockedSuffixes | Where-Object { $fullName.EndsWith($_, [System.StringComparison]::OrdinalIgnoreCase) })
  } | Remove-Item -Force
}

$SharedExcludeDirs = @(
  "node_modules", ".git", ".expo", ".parcel-cache", ".cache", "coverage",
  ".turbo", ".next", ".gradle", ".idea", ".vscode", "eas-build",
  ".venv", ".venv-stt", ".pytest_cache", "__pycache__", "media",
  "backend\media", "uploads", "logs", "tmp", "temp", "backups",
  "artifacts", "playwright-report", "test-results", "htmlcov"
)

$LiteOnlyExcludeDirs = @(
  "android", "ios", "dist", "build"
)

$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$LiteStaging = Join-Path $env:TEMP "handover-pro_lite_$ts"
$FullStaging = Join-Path $env:TEMP "handover-pro_full_$ts"
$LiteZipTemp = Join-Path $env:TEMP "handover-pro_lite_$ts.zip"
$FullZipTemp = Join-Path $env:TEMP "handover-pro_full_$ts.zip"
$LiteZipDest = Join-Path $OutDir "handover-pro_lite_$ts.zip"
$FullZipDest = Join-Path $OutDir "handover-pro_full_$ts.zip"

Write-Host "== LITE staging ==" -ForegroundColor Cyan
New-StagingCopy -Source $Project -Destination $LiteStaging -ExcludeDirs ($SharedExcludeDirs + $LiteOnlyExcludeDirs)
Remove-SensitiveFiles -Root $LiteStaging

$files = (Get-ChildItem $LiteStaging -Recurse -File | Measure-Object).Count
if ($files -eq 0) { throw "Staging vacío (0 archivos). Revisa la ruta del proyecto o las exclusiones." }
Write-Host "Staging OK: $files archivos" -ForegroundColor Green

# Crear ZIP LITE
if (Test-Path $LiteZipTemp) { Remove-Item $LiteZipTemp -Force }
Write-Host "== Creando ZIP LITE ==" -ForegroundColor Cyan
Compress-Archive -Path "$LiteStaging\*" -DestinationPath $LiteZipTemp -CompressionLevel Optimal -Force

# Crear ZIP FULL (incluye codigo nativo, pero sigue excluyendo secretos y runtime local)
Write-Host "== FULL staging ==" -ForegroundColor Cyan
New-StagingCopy -Source $Project -Destination $FullStaging -ExcludeDirs $SharedExcludeDirs
Remove-SensitiveFiles -Root $FullStaging

if (Test-Path $FullZipTemp) { Remove-Item $FullZipTemp -Force }
Write-Host "== Creando ZIP FULL (puede tardar) ==" -ForegroundColor Cyan
Compress-Archive -Path "$FullStaging\*" -DestinationPath $FullZipTemp -CompressionLevel Optimal -Force

# Validar y mover
Write-Host "== Validando ZIPs ==" -ForegroundColor Cyan
if (-not (Test-Zip $LiteZipTemp)) { throw "ZIP LITE corrupto." }
if (-not (Test-Zip $FullZipTemp)) { throw "ZIP FULL corrupto." }

Move-Item -Force $LiteZipTemp $LiteZipDest
Move-Item -Force $FullZipTemp $FullZipDest

# Limpieza
Remove-Item $LiteStaging -Recurse -Force
Remove-Item $FullStaging -Recurse -Force

$lite = Get-Item $LiteZipDest
$full = Get-Item $FullZipDest
Write-Host "`nZips listos:" -ForegroundColor Green
Write-Host ("  LITE : {0}  ({1:N0} KB)" -f $lite.FullName, ($lite.Length/1KB))
Write-Host ("  FULL : {0}  ({1:N0} KB)" -f $full.FullName, ($full.Length/1KB))
Write-Host "Ambos ZIPs excluyen secretos, bases locales y artefactos runtime compartibles." -ForegroundColor Yellow
