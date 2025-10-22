param(
  [string]$Project = "C:\Users\luism\OneDrive\Escritorio\Nurseos\handover-pro",
  [string]$OutDir  = (Split-Path "C:\Users\luism\OneDrive\Escritorio\Nurseos\handover-pro" -Parent)
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Test-Zip([string]$ZipPath) {
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
    [System.IO.Compression.ZipFile]::OpenRead($ZipPath).Dispose()
    return $true
  } catch {
    return $false
  }
}

# Excluir en LITE
$ExcludeDirs = @(
  "node_modules",".git",".expo",".parcel-cache",".cache","coverage",
  "android","ios","dist","build",".turbo",".next",".gradle",
  ".idea",".vscode","eas-build",".venv-stt"
)

$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$Staging     = Join-Path $env:TEMP "handover-pro_lite_$ts"
$LiteZipTemp = Join-Path $env:TEMP "handover-pro_lite_$ts.zip"
$FullZipTemp = Join-Path $env:TEMP "handover-pro_full_$ts.zip"
$LiteZipDest = Join-Path $OutDir   "handover-pro_lite_$ts.zip"
$FullZipDest = Join-Path $OutDir   "handover-pro_full_$ts.zip"

Write-Host "== LITE staging ==" -ForegroundColor Cyan
if (Test-Path $Staging) { Remove-Item $Staging -Recurse -Force }
New-Item -ItemType Directory -Path $Staging | Out-Null

# Copia con robocopy + exclusiones y log visible
$rcArgs = @($Project, $Staging, "/MIR","/R:1","/W:1","/NFL","/NDL","/NJH","/NJS","/NP")
foreach ($d in $ExcludeDirs) { $rcArgs += @("/XD", (Join-Path $Project $d)) }
$robolog = robocopy @rcArgs
$code = $LASTEXITCODE
Write-Host $robolog
if ($code -gt 7) { throw "Robocopy falló (código $code)" }

$files = (Get-ChildItem $Staging -Recurse -File | Measure-Object).Count
if ($files -eq 0) { throw "Staging vacío (0 archivos). Revisa la ruta del proyecto o las exclusiones." }
Write-Host "Staging OK: $files archivos" -ForegroundColor Green

# Crear ZIP LITE
if (Test-Path $LiteZipTemp) { Remove-Item $LiteZipTemp -Force }
Write-Host "== Creando ZIP LITE ==" -ForegroundColor Cyan
Compress-Archive -Path "$Staging\*" -DestinationPath $LiteZipTemp -CompressionLevel Optimal -Force

# Crear ZIP FULL (esta parte puede tardar)
if (Test-Path $FullZipTemp) { Remove-Item $FullZipTemp -Force }
Write-Host "== Creando ZIP FULL (puede tardar) ==" -ForegroundColor Cyan
Compress-Archive -Path "$Project\*" -DestinationPath $FullZipTemp -CompressionLevel Optimal -Force

# Validar y mover
Write-Host "== Validando ZIPs ==" -ForegroundColor Cyan
if (-not (Test-Zip $LiteZipTemp)) { throw "ZIP LITE corrupto." }
if (-not (Test-Zip $FullZipTemp)) { throw "ZIP FULL corrupto." }

Move-Item -Force $LiteZipTemp $LiteZipDest
Move-Item -Force $FullZipTemp $FullZipDest

# Limpieza
Remove-Item $Staging -Recurse -Force

$lite = Get-Item $LiteZipDest
$full = Get-Item $FullZipDest
Write-Host "`nZips listos:" -ForegroundColor Green
Write-Host ("  LITE : {0}  ({1:N0} KB)" -f $lite.FullName, ($lite.Length/1KB))
Write-Host ("  FULL : {0}  ({1:N0} KB)" -f $full.FullName, ($full.Length/1KB))
