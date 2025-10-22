# Arranca Metro+Expo con variables visibles
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$env:EXPO_USE_DEV_SERVER = "true"
$env:REACT_NATIVE_PACKAGER_HOSTNAME = "127.0.0.1"

Write-Host "Iniciando Expo..." -ForegroundColor Green
pnpm expo start --tunnel
