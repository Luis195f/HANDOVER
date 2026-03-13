---
name: release-pilot-grade
description: Use this skill before declaring a branch ready for PR or pilot-grade release in HANDOVER. It checks tests, type safety, linting, FHIR validation, sensitive areas, and minimum documentation hygiene.
---

# release-pilot-grade

## Purpose

Provide a conservative pre-PR and pre-release gate for HANDOVER.

## Use this skill when

- A branch is thought to be ready for PR
- A task touched sensitive modules
- A reviewer wants a release-readiness summary
- A change claims to be pilot-grade, production-grade or review-ready

## Scope

This skill is especially relevant if the branch touched any of:

- FHIR mapping or validation
- sync/queue/networking
- auth/security/PHI
- HandoverForm
- profile runtime
- backend contracts
- ICEA bridge

## Workflow

1. Summarize the purpose of the branch.
2. List sensitive files changed.
3. Run or inspect:
   - typecheck
   - lint
   - tests
   - FHIR validation if applicable
4. Review whether new `any`, `@ts-ignore`, hidden fallbacks or contract drift were introduced.
5. Check whether docs were updated where needed.
6. Produce a verdict:
   - ready for PR
   - ready with minor fixes
   - not ready

## Minimum checks

Prefer the real repo commands. Common examples:

- `pnpm -w typecheck`
- `pnpm -w lint`
- `pnpm -w test`
- `pnpm validate:fhir`

If exact commands differ, use the project’s actual scripts.

## Hard blockers

- broken typecheck
- broken lint in touched areas
- missing tests for a sensitive contract change
- PHI risk introduced
- undocumented contract drift
- hidden security fallback
- obvious regression in runtime profiles or offline sync

## Output format

Always report:
- purpose
- sensitive files changed
- checks run
- checks not run
- risks residuals
- verdict

## Definition of done

A branch guarded by this skill is only done when:
- the critical checks passed or failures are explicitly understood
- the risks are honestly stated
- the readiness verdict is justified
