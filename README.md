# FootLabOS

**Technology is the crew. The person is the destination.**

FootLabOS is a local-first operating system for longitudinal at-risk foot monitoring, human review, personalized insert manufacturing, and ongoing follow-up.

It is not a doctor, diagnostic service, or replacement for a person's care team. FootLabOS coordinates observations, history, manufacturing, consent, and follow-up so the right humans can make better-informed decisions sooner.

## V1 product loop

`SMS link -> guided foot capture -> local processing -> longitudinal comparison -> review queue -> Flight Sheet -> insert/design action -> manufacture -> wear feedback -> next observation`

## V1 surfaces

| Surface | Purpose |
| --- | --- |
| `client-link` | No-app, no-password guided capture and check-in |
| `operator` | TODAY / NEEDS REVIEW / CLIENTS / FLIGHTS / MANUFACTURING / EDGE |
| `clinical-review` | Human review of observations and escalations |
| `manufacturing` | Design version, material, print, QA, delivery, adjustment |
| `edge-console` | Appliance health, storage, models, sync, audit, consent |

## Repository

```text
apps/
  client-link/
  operator/
  clinical-review/
  manufacturing/
  edge-console/
packages/
  domain/
  flight-engine/
  edge-contracts/
  shared/
docs/
  architecture/
  product/
  safety/
  pilot/
```

## Non-negotiables

1. **No app required for the client.** A secure one-tap link should be enough for routine participation.
2. **Local-first by design.** Sensitive client data lives on the assigned FootLab Edge appliance by default.
3. **Human-in-the-loop.** AI may organize, compare, summarize, and flag; it does not diagnose, clear, or replace clinicians.
4. **Longitudinal beats episodic.** Every observation becomes part of a time-ordered Foot Profile.
5. **Manufacturing is in the loop.** Monitoring can create a concrete design or adjustment action with traceability.
6. **Consent is explicit.** Sharing outside the client's local FootLab environment is intentional, scoped, and auditable.
7. **Minimize client workload.** Complexity belongs in FootLabOS, not in the person's daily routine.

## Status

V1 foundation: architecture, domain contracts, Flight Sheet model, Edge Appliance spec, safety boundaries, operator information architecture, and pilot protocol.
