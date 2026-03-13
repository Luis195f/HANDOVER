---
name: icea-bridge-contract-check
description: Use this skill when a task touches the HANDOVER to ICEA+ bridge, scoring contracts, scheduler behavior, aliases, bridge payloads, or backend endpoints related to enriched scoring.
---

# icea-bridge-contract-check

## Purpose

Protect bridge contracts between HANDOVER and ICEA+ from accidental HTTP breakage, duplicated scheduling, unstable aliases, or undocumented payload drift.

## Use this skill when

- A task modifies bridge views or services
- A task modifies scoring mode behavior
- A task modifies queueing or scheduling around bridge requests
- A task changes payload names, aliases or response shapes
- A task changes bridge error names or error semantics
- A task modifies frontend types that consume bridge responses

## Files to inspect first

- `backend/api/views_icea_bridge.py`
- `backend/api/icea_bridge_service.py`
- `backend/api/tests/*icea*`
- `docs/icea-bridge.md`
- `docs/icea-integration.md`
- frontend types and bridge client code if present

## Workflow

1. Identify the current HTTP contract and scheduler source of truth.
2. Enumerate request and response fields touched by the change.
3. Verify whether aliases are additive or breaking.
4. Ensure scheduling happens in one place only.
5. Ensure retry or retrigger logic is explicit and test-backed.
6. Add or update tests for same-mode and alternate-mode behavior where relevant.
7. Update docs if contract, aliases, errors or operational flow changed.

## Minimum checks

Use the real project commands. Prefer:

- backend test command for bridge tests
- repo typecheck if frontend types changed
- targeted test run for the bridge module

If exact commands differ, inspect the repo and use the real ones.

## Hard blockers

Block the change if any of these happen:

- HTTP payload changes without tests
- undocumented error renames
- duplicated scheduling side effects
- ambiguous retrigger behavior
- inconsistent aliases between docs and code
- silent contract drift between backend and frontend

## Definition of done

A change guarded by this skill is only done when:

- the bridge contract is stable or explicitly versioned/documented
- scheduling has a single source of truth
- tests prove the intended flow
- docs reflect actual runtime behavior
