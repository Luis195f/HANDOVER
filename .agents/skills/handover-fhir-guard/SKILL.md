---
name: handover-fhir-guard
description: Use this skill when a task touches FHIR mapping, bundle generation, validation schemas, terminology dictionaries, or any contract that could change the clinical FHIR output in HANDOVER.
---

# handover-fhir-guard

## Purpose

Protect the FHIR layer of HANDOVER from accidental contract breakage, semantic drift, missing tests, and undocumented terminology changes.

## Use this skill when

- A task modifies `src/lib/fhir-map*`
- A task modifies `src/lib/fhir-validation*`
- A task modifies `src/validation/*`
- A task modifies code dictionaries, code systems, LOINC, SNOMED, UCUM or related helpers
- A task changes generated Bundle shape, resource references, signatures or resource assembly
- A task refactors mapper structure by domain

## Do not use this skill when

- The task is purely visual and does not affect data shape
- The task only changes docs unrelated to FHIR behavior
- The task only updates styling, copy or layout with no schema impact

## Files to inspect first

- `src/lib/fhir-map.ts`
- `src/lib/fhir-map/**`
- `src/lib/fhir-validation/**`
- `src/lib/codes.ts`
- `src/validation/**`
- Relevant tests under `src/lib/__tests__/**`, `tests/**` or equivalent

## Workflow

1. Identify the public FHIR contract that exists today.
2. List the exact resources, codings, extensions or references affected.
3. Check whether the change is semantic or purely structural.
4. Preserve backwards compatibility whenever possible.
5. If refactoring, keep a stable public entry point or add a compatibility layer.
6. Replace literal codes with centralized constants when possible.
7. Add or update tests covering the changed domain.
8. Update docs if the behavior or contract changed.

## Minimum checks

Run the closest real commands that exist in the repo. Prefer these if available:

- `pnpm -w typecheck`
- `pnpm -w test`
- `pnpm validate:fhir`

If a listed command does not exist, inspect `package.json` and use the nearest equivalent instead of inventing a new one.

## Hard blockers

Block the change if any of these happen:

- Bundle/resource shape changes without tests
- Coding changes without validation or review
- New hardcoded clinical codes where a central dictionary should be used
- Silent semantic changes in observations, medication statements, conditions, procedures or composition
- Broken references between resources
- PHI leaking into logs or debug messages

## Definition of done

A change guarded by this skill is only done when:

- the intended FHIR behavior is preserved or explicitly documented
- terminology changes are centralized
- relevant tests pass
- contract risks are declared honestly
