---
name: clinical-profile-runtime-audit
description: Use this skill when a task touches clinical profiles, units config, specialty overlays, runtime visibility, profile flags, precedence rules, or compatibility between the core form and unit/specialty customizations.
---

# clinical-profile-runtime-audit

## Purpose

Audit and protect the relationship between the HANDOVER core, unit packs, specialty overlays and resolved runtime behavior.

## Use this skill when

- A task modifies `src/config/profiles/**`
- A task modifies `src/config/unitsConfig*`
- A task modifies `src/lib/profile-runtime*`
- A task changes visibility, flags, field activation or overlay precedence
- A task introduces a new unit or specialty configuration
- A task changes how legacy or contextual aliases resolve

## Rules

- Preserve a shared core before specialization.
- Do not duplicate whole forms per unit unless absolutely unavoidable.
- Make precedence explicit and testable.
- Keep runtime resolution deterministic.
- Favor additive overlays over destructive forks.

## Workflow

1. Identify the current precedence model.
2. List the fields or behaviors affected.
3. Determine whether the change is core, unit-specific, specialty-specific or legacy-compatibility related.
4. Verify that the change does not unexpectedly reactivate or hide unrelated fields.
5. Add or update tests for runtime resolution, flags and visibility.
6. Update docs if profile behavior materially changes.

## Files to inspect first

- `src/config/profiles/**`
- `src/config/unitsConfig.ts`
- `src/lib/profile-runtime.ts`
- tests around catalog, runtime, visibility, flags and overlays
- docs on profiles or architecture if present

## Minimum checks

Prefer real project commands such as:

- `pnpm -w typecheck`
- `pnpm -w test`

Focus on targeted runtime/profile tests when available.

## Hard blockers

Block the change if any of these happen:

- whole-form duplication without necessity
- implicit precedence changes without tests
- overlays reactivating hidden fields unexpectedly
- profile aliases collapsing important context incorrectly
- docs and runtime diverging

## Definition of done

A change guarded by this skill is only done when:

- precedence is explicit
- compatibility is tested
- field activation is auditable
- runtime behavior remains understandable to future maintainers
