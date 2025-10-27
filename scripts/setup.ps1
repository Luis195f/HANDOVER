# Requiere PowerShell 7
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "Instalando dependencias Expo/TS y utilidades..." -ForegroundColor Cyan
pnpm add expo-notifications expo-audio expo-camera expo-file-system expo-secure-store @react-native-async-storage/async-storage crypto-js

Write-Host "Asegurando tipos y utilidades" -ForegroundColor Cyan
pnpm add -D @types/node

Write-Host "Listo. Recuerda ajustar FHIR_BASE_URL y STT_ENDPOINT en app.json -> expo.extra." 
