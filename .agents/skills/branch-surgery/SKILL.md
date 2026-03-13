---
name: branch-surgery
description: Use this skill to review a HANDOVER branch surgically: identify touched files, infer risk areas, decide what tests are required, and give a clear verdict on whether the branch is apt for PR.
---

# branch-surgery

## Purpose

Rapidly inspect a working branch and produce a high-value technical verdict without hand-wavy approval.

## Use this skill when

- You want to know whether a branch is apt for PR
- You received a patch, diff or Codex output and need a disciplined review
- You need a concise risk map before merge
- You want to know the next exact steps after a change set

## Workflow

1. Identify the branch goal from commit messages, diff or prompt context.
2. List changed files.
3. Group them by risk area:
   - UI only
   - validation/schema
   - FHIR/interop
   - sync/offline
   - profiles/runtime
   - backend contracts
   - auth/security
   - docs only
4. Infer which tests are mandatory.
5. Check for scope creep.
6. Check for likely regressions.
7. Emit a verdict and exact next actions.

## Review rules

- Be conservative with sensitive modules.
- Do not approve based on optimism.
- Prefer evidence from diff + tests over assumptions.
- Call out missing docs, missing tests and hidden contract changes.

## Output format

Always return:

1. Summary
2. Files touched
3. Technical risks
4. Clinical/operational risks if any
5. Required tests
6. Missing pieces
7. PR verdict:
   - apt
   - apt with fixes
   - not apt

## Hard blockers

- changes in sensitive modules with no tests
- contract drift without docs
- duplicated scheduling or retry ambiguity
- FHIR mapper changes without validation
- runtime/profile changes without precedence tests
- security regressions or PHI exposure

## Definition of done

A branch reviewed by this skill is only done when the verdict is explicit and backed by concrete findings.                              La ruta de branch-surgery es:

.agents/skills/branch-surgery/SKILL.md 
