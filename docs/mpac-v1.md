# MPAC v1 - Hybrid explainable rules engine

MPAC v1 adds a pure and typed priority pipeline for HANDOVER without changing the current app architecture.

## Scope

- Keeps the current React Native / Expo + TypeScript frontend.
- Does not add ML, opaque scoring, or new production dependencies.
- Does not change FHIR contracts, ICEA runtime contracts, or profile activation defaults.
- Preserves the priority facade in `src/lib/priority.ts` for backward compatibility.

## Pipeline

`src/lib/mpac.ts` computes a contextual nursing priority from explicit rules.

Formula in v1:

```text
Total priority =
  instability
  + deterioration risk
  + dependency / surveillance
  + time critical pending work
  + therapeutic load
  + active unit modifiers
  + active specialty modifiers
```

## Core signal separation

Base scoring is always computed from patient data only:

- NEWS2 and red flags
- active devices / critical support
- active risks
- open, urgent, overdue, or reevaluation tasks
- recent incidents / clinical change markers

Unit and specialty context stays separate and additive:

- unit profile signals act as UPP modifiers
- specialty overlay signals act as SOP modifiers
- catalog entries do not become active unless profile activation enables them

## Explainability output

Every MPAC result includes a serializable explanation with:

- source data summary
- detected clinical change summary
- critical or urgent pending tasks
- active context (core / unit / overlay)
- dimension-by-dimension core scoring
- applied contextual modifiers
- optional human override trace

## Human override

`manualOverride` can raise or lower the effective priority level while keeping:

- the base level
- the numeric base score
- the override rationale in the serialized explanation

This keeps the nurse decision visible instead of replacing the trace.

## Future evolution

`src/lib/mpac.ts` exposes an optional future extension interface so a later additive predictor can contribute a bounded score delta with its own note, without replacing the rules engine.

## UI surfacing

The contextual priority output is surfaced in the existing React Native experience without creating a parallel workflow:

- PatientList can auto-sort only when there is actionable contextual signal and otherwise falls back to the received order.
- Each patient card shows a compact, non-alarmist explanation covering why the patient is elevated, what cannot be omitted, and the active time window when available.
- SupervisorDashboard reuses the same patient census and MPAC facade to expose a unit-level priority snapshot for supervision.
- Behavioral-health demos can project explainable continuity priorities through the existing profile runtime copy (`focusAreas`, `explanations`, `visibleOutputs`, checklist labels) without adding a psychiatric scorer, autonomous recommendation engine, or new persisted schema.
- That projection is editorial and prudential: it must not be presented as clinically validated psychiatric scoring, ranking, or replacement for nurse judgment.

## Validation

Relevant tests:

- `tests/lib/mpac.spec.ts`
- `tests/lib/priority.spec.ts`
- `tests/lib/analytics.spec.ts`

