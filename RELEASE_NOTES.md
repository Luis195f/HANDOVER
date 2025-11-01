# Release Notes — v0.4.0-rc.1

> Fecha estimada: febrero 2025

## Resumen
- Validación completa de bundles FHIR con referencias cruzadas y DeviceUseStatement para oxigenoterapia.
- Nuevas pruebas de integración FHIR (`__tests__/fhir/bundle-validation.spec.ts`).
- CLI `pnpm validate:fhir` para pipelines externos.
- CI GitHub Actions con typecheck, lint y vitest.
- Documentación extendida para setup, despliegue (Android/iOS/Web) y manejo offline.

## Checklist previo a la publicación
- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm vitest run --reporter=verbose`
- [ ] Validación manual de bundles relevantes (`pnpm validate:fhir`).
- [ ] Carga de artefactos (APK/AAB, IPA/TestFlight, paquete web).
- [ ] Actualización de notas de release en GitHub/EAS.

## Problemas conocidos
- Requiere acceso a Internet para instalar dependencias via pnpm (configura mirror si tu red bloquea `registry.npmjs.org`).
- La validación CLI depende de `pnpm dlx tsx`; en entornos sin salida a Internet instala `tsx` previamente en un registro interno.

## Enlaces útiles
- [docs/DEPLOY.md](docs/DEPLOY.md)
- [README](README.md)
- `.github/workflows/ci.yml`
