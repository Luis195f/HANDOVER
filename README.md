<!-- BEGIN HANDOVER: README -->
# Handover
## Requisitos
- Node 20, pnpm 9, Expo CLI, EAS CLI.
## Cómo correr
pnpm i && pnpm start -c
## Build
npx eas build -p android --profile preview
## Tests
pnpm test  |  detox ver /e2e
## Variables de entorno
Ver .env.example (usar EAS Secrets para valores reales)
## Permisos
Cámara (QR), Micrófono (dictado)
## Troubleshooting
- Limpia caché: rm -rf node_modules && pnpm i
<!-- END HANDOVER: README -->
