# Summary
- 

# Scope
- 

# How to test
```
# Pilot-grade quality gates
pnpm -w quality:pilot

# Focused reruns when needed
pnpm -w test:pilot:coverage
pnpm -w test:smoke:forms
pnpm -w gate:any-sensitive
pnpm -w validate:fhir:fixture
```

# Coverage
- Note: pilot-grade coverage runs through `vitest.pilot.config.ts`.
- Note: If coverage fails due to registry access for `@vitest/coverage-v8`, note it here.

# PHI/Security
- [ ] No PHI in logs/snapshots
- [ ] No PHI in fixtures/test data
- [ ] No PHI in screenshots

# Reviewer checklist
- [ ] Scope matches summary and is limited to intended changes
- [ ] Tests/commands in this PR are documented and results reported
- [ ] Coverage expectations and gaps are clearly stated
- [ ] No PHI or sensitive data introduced

