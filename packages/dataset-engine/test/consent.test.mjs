import test from "node:test";
import assert from "node:assert/strict";
import {
  ConsentEvaluationError,
  evaluateConsent,
} from "../src/consent.ts";

// ---------- fixture helpers ----------

// Consent evaluator only reads: eventType, eventId, subjectId, occurredAt,
// recordedAt, payload. We keep fixtures minimal but valid plain objects.

function makeConsentEvent({
  eventId,
  subjectId,
  eventType,
  occurredAt,
  recordedAt,
  payload,
} = {}) {
  return {
    eventId,
    caseId: "TEST-CASE-1",
    subjectId,
    eventType,
    occurredAt,
    recordedAt: recordedAt ?? occurredAt,
    payload,
  };
}

function grantEvent({ eventId, subjectId, occurredAt, consentId, purpose, expiresAt }) {
  const payload = { consentId, purpose };
  if (expiresAt !== undefined) payload.expiresAt = expiresAt;
  return makeConsentEvent({
    eventId,
    subjectId,
    eventType: "consent_granted",
    occurredAt,
    payload,
  });
}

function revokeEvent({ eventId, subjectId, occurredAt, consentId, reason }) {
  return makeConsentEvent({
    eventId,
    subjectId,
    eventType: "consent_revoked",
    occurredAt,
    payload: { consentId, reason },
  });
}

function makeRequest({
  subjectId = "TEST-SUBJ-1",
  dataClassification = "identified",
  purpose,
  evaluatedAt = "2026-09-23T12:00:00Z",
} = {}) {
  const request = { subjectId, dataClassification, evaluatedAt };
  if (purpose !== undefined) request.purpose = purpose;
  return request;
}

function shuffled(arr) {
  // Deterministic stable shuffle for reproducibility in tests.
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = (i * 31 + 7) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------- synthetic exemption ----------

test("synthetic request with SYN- subject returns synthetic exemption", () => {
  const evidence = evaluateConsent(
    [
      grantEvent({
        eventId: "TEST-EV-100",
        subjectId: "SYN-SUBJ-1",
        occurredAt: "2026-09-23T11:00:00Z",
        consentId: "TEST-CNS-1",
        purpose: "model_training",
      }),
    ],
    makeRequest({
      subjectId: "SYN-SUBJ-1",
      dataClassification: "synthetic",
    }),
  );
  assert.deepEqual(evidence, {
    decision: "synthetic_exemption",
    evaluatedAt: "2026-09-23T12:00:00Z",
    evidenceEventIds: [],
    reason: "synthetic_data_exempt",
  });
});

test("synthetic request without purpose returns exemption even without grants", () => {
  const evidence = evaluateConsent([], makeRequest({
    subjectId: "SYN-SUBJ-9",
    dataClassification: "synthetic",
  }));
  assert.equal(evidence.decision, "synthetic_exemption");
  assert.equal(evidence.reason, "synthetic_data_exempt");
  assert.deepEqual(evidence.evidenceEventIds, []);
});

test("invalid synthetic request: non-SYN- subject is rejected", () => {
  assert.throws(
    () =>
      evaluateConsent(
        [],
        makeRequest({ subjectId: "TEST-SUBJ-1", dataClassification: "synthetic" }),
      ),
    (err) => {
      assert.ok(err instanceof ConsentEvaluationError);
      assert.match(err.message, /synthetic/i);
      assert.doesNotMatch(err.message, /TEST-SUBJ-1/);
      return true;
    },
  );
});

test("invalid synthetic request: purpose present is rejected", () => {
  assert.throws(
    () =>
      evaluateConsent(
        [],
        makeRequest({
          subjectId: "SYN-SUBJ-1",
          dataClassification: "synthetic",
          purpose: "model_training",
        }),
      ),
    (err) => {
      assert.ok(err instanceof ConsentEvaluationError);
      assert.match(err.message, /purpose/i);
      return true;
    },
  );
});

// ---------- request validation ----------

test("default denial: identified request without purpose is rejected", () => {
  assert.throws(
    () => evaluateConsent([], makeRequest({ purpose: undefined })),
    (err) => {
      assert.ok(err instanceof ConsentEvaluationError);
      assert.match(err.message, /purpose/i);
      return true;
    },
  );
});

test("pseudonymized request without purpose is rejected", () => {
  assert.throws(
    () =>
      evaluateConsent(
        [],
        makeRequest({ dataClassification: "pseudonymized", purpose: undefined }),
      ),
    (err) => {
      assert.ok(err instanceof ConsentEvaluationError);
      assert.match(err.message, /purpose/i);
      return true;
    },
  );
});

test("empty subjectId is rejected", () => {
  assert.throws(
    () =>
      evaluateConsent(
        [],
        makeRequest({ subjectId: "", purpose: "model_training" }),
      ),
    ConsentEvaluationError,
  );
});

test("subjectId with leading or trailing whitespace is rejected", () => {
  assert.throws(
    () =>
      evaluateConsent(
        [],
        makeRequest({ subjectId: " TEST-SUBJ-1", purpose: "model_training" }),
      ),
    ConsentEvaluationError,
  );
});

test("subjectId with control characters is rejected", () => {
  assert.throws(
    () =>
      evaluateConsent(
        [],
        makeRequest({ subjectId: "TEST\u0000SUBJ", purpose: "model_training" }),
      ),
    ConsentEvaluationError,
  );
});

test("invalid evaluatedAt (offset, not Z) is rejected", () => {
  assert.throws(
    () =>
      evaluateConsent(
        [],
        makeRequest({ evaluatedAt: "2026-09-23T12:00:00+04:00", purpose: "model_training" }),
      ),
    ConsentEvaluationError,
  );
});

test("invalid evaluatedAt (impossible date) is rejected", () => {
  assert.throws(
    () =>
      evaluateConsent(
        [],
        makeRequest({ evaluatedAt: "2026-02-30T12:00:00Z", purpose: "model_training" }),
      ),
    ConsentEvaluationError,
  );
});

test("unknown classification is rejected", () => {
  assert.throws(
    () =>
      evaluateConsent(
        [],
        makeRequest({ dataClassification: "anonymized", purpose: "model_training" }),
      ),
    ConsentEvaluationError,
  );
});

test("unknown purpose is rejected", () => {
  assert.throws(
    () =>
      evaluateConsent(
        [],
        makeRequest({ purpose: "telemetry" }),
      ),
    ConsentEvaluationError,
  );
});

// ---------- default denial (no grants) ----------

test("no matching grant: identified request with no consent events is denied", () => {
  const evidence = evaluateConsent(
    [],
    makeRequest({ purpose: "model_training" }),
  );
  assert.deepEqual(evidence, {
    decision: "denied",
    purpose: "model_training",
    evaluatedAt: "2026-09-23T12:00:00Z",
    evidenceEventIds: [],
    reason: "no_matching_consent",
  });
});

// ---------- matching active grant ----------

test("matching active grant is allowed with the grant event as evidence", () => {
  const evidence = evaluateConsent(
    [
      grantEvent({
        eventId: "TEST-EV-200",
        subjectId: "TEST-SUBJ-1",
        occurredAt: "2026-09-23T11:00:00Z",
        consentId: "TEST-CNS-2",
        purpose: "model_training",
      }),
    ],
    makeRequest({ purpose: "model_training" }),
  );
  assert.deepEqual(evidence, {
    decision: "allowed",
    purpose: "model_training",
    evaluatedAt: "2026-09-23T12:00:00Z",
    evidenceEventIds: ["TEST-EV-200"],
    reason: "active_consent",
  });
});

// ---------- wrong subject / wrong purpose ignored ----------

test("grant for wrong subject is ignored", () => {
  const evidence = evaluateConsent(
    [
      grantEvent({
        eventId: "TEST-EV-300",
        subjectId: "TEST-SUBJ-OTHER",
        occurredAt: "2026-09-23T11:00:00Z",
        consentId: "TEST-CNS-3",
        purpose: "model_training",
      }),
    ],
    makeRequest({ subjectId: "TEST-SUBJ-1", purpose: "model_training" }),
  );
  assert.equal(evidence.decision, "denied");
  assert.equal(evidence.reason, "no_matching_consent");
  assert.deepEqual(evidence.evidenceEventIds, []);
});

test("grant for wrong purpose is ignored", () => {
  const evidence = evaluateConsent(
    [
      grantEvent({
        eventId: "TEST-EV-301",
        subjectId: "TEST-SUBJ-1",
        occurredAt: "2026-09-23T11:00:00Z",
        consentId: "TEST-CNS-4",
        purpose: "quality_improvement",
      }),
    ],
    makeRequest({ purpose: "model_training" }),
  );
  assert.equal(evidence.decision, "denied");
  assert.equal(evidence.reason, "no_matching_consent");
});

// ---------- future events ignored ----------

test("future grant is ignored for historical evaluation", () => {
  const evidence = evaluateConsent(
    [
      grantEvent({
        eventId: "TEST-EV-400",
        subjectId: "TEST-SUBJ-1",
        occurredAt: "2026-09-23T13:00:00Z",
        consentId: "TEST-CNS-5",
        purpose: "model_training",
      }),
    ],
    makeRequest({ evaluatedAt: "2026-09-23T12:00:00Z", purpose: "model_training" }),
  );
  assert.equal(evidence.decision, "denied");
  assert.equal(evidence.reason, "no_matching_consent");
});

test("future revocation does not alter a past valid grant", () => {
  const evidence = evaluateConsent(
    [
      grantEvent({
        eventId: "TEST-EV-401",
        subjectId: "TEST-SUBJ-1",
        occurredAt: "2026-09-23T11:00:00Z",
        consentId: "TEST-CNS-6",
        purpose: "model_training",
      }),
      revokeEvent({
        eventId: "TEST-EV-402",
        subjectId: "TEST-SUBJ-1",
        occurredAt: "2026-09-23T13:00:00Z",
        consentId: "TEST-CNS-6",
        reason: "withdrawn",
      }),
    ],
    makeRequest({ evaluatedAt: "2026-09-23T12:00:00Z", purpose: "model_training" }),
  );
  // Revocation at 13:00 is in the future relative to evaluatedAt 12:00;
  // the grant is still valid as of 12:00.
  assert.equal(evidence.decision, "allowed");
  assert.equal(evidence.reason, "active_consent");
});

// ---------- revoked ----------

test("revoked grant is denied with both grant and revocation evidence", () => {
  const evidence = evaluateConsent(
    [
      grantEvent({
        eventId: "TEST-EV-500",
        subjectId: "TEST-SUBJ-1",
        occurredAt: "2026-09-23T11:00:00Z",
        consentId: "TEST-CNS-7",
        purpose: "model_training",
      }),
      revokeEvent({
        eventId: "TEST-EV-501",
        subjectId: "TEST-SUBJ-1",
        occurredAt: "2026-09-23T11:30:00Z",
        consentId: "TEST-CNS-7",
        reason: "withdrawn",
      }),
    ],
    makeRequest({ evaluatedAt: "2026-09-23T12:00:00Z", purpose: "model_training" }),
  );
  assert.deepEqual(evidence, {
    decision: "denied",
    purpose: "model_training",
    evaluatedAt: "2026-09-23T12:00:00Z",
    evidenceEventIds: ["TEST-EV-500", "TEST-EV-501"],
    reason: "consent_revoked",
  });
});

test("fresh grant after an earlier revoked grant is allowed", () => {
  const evidence = evaluateConsent(
    [
      grantEvent({
        eventId: "TEST-EV-600",
        subjectId: "TEST-SUBJ-1",
        occurredAt: "2026-09-23T10:00:00Z",
        consentId: "TEST-CNS-8",
        purpose: "model_training",
      }),
      revokeEvent({
        eventId: "TEST-EV-601",
        subjectId: "TEST-SUBJ-1",
        occurredAt: "2026-09-23T10:30:00Z",
        consentId: "TEST-CNS-8",
        reason: "withdrawn",
      }),
      grantEvent({
        eventId: "TEST-EV-602",
        subjectId: "TEST-SUBJ-1",
        occurredAt: "2026-09-23T11:00:00Z",
        consentId: "TEST-CNS-9",
        purpose: "model_training",
      }),
    ],
    makeRequest({ evaluatedAt: "2026-09-23T12:00:00Z", purpose: "model_training" }),
  );
  assert.equal(evidence.decision, "allowed");
  assert.equal(evidence.reason, "active_consent");
  assert.deepEqual(evidence.evidenceEventIds, ["TEST-EV-602"]);
});

// ---------- expired ----------

test("expired grant is denied", () => {
  const evidence = evaluateConsent(
    [
      grantEvent({
        eventId: "TEST-EV-700",
        subjectId: "TEST-SUBJ-1",
        occurredAt: "2026-09-23T10:00:00Z",
        consentId: "TEST-CNS-10",
        purpose: "model_training",
        expiresAt: "2026-09-23T11:00:00Z",
      }),
    ],
    makeRequest({ evaluatedAt: "2026-09-23T12:00:00Z", purpose: "model_training" }),
  );
  assert.deepEqual(evidence, {
    decision: "denied",
    purpose: "model_training",
    evaluatedAt: "2026-09-23T12:00:00Z",
    evidenceEventIds: ["TEST-EV-700"],
    reason: "consent_expired",
  });
});

test("grant is still valid just before its expiration", () => {
  const evidence = evaluateConsent(
    [
      grantEvent({
        eventId: "TEST-EV-701",
        subjectId: "TEST-SUBJ-1",
        occurredAt: "2026-09-23T10:00:00Z",
        consentId: "TEST-CNS-11",
        purpose: "model_training",
        expiresAt: "2026-09-23T11:00:00.000Z",
      }),
    ],
    makeRequest({
      evaluatedAt: "2026-09-23T10:59:59.999Z",
      purpose: "model_training",
    }),
  );
  assert.equal(evidence.decision, "allowed");
  assert.equal(evidence.reason, "active_consent");
});

test("at the exact expiration boundary the grant is expired", () => {
  const evidence = evaluateConsent(
    [
      grantEvent({
        eventId: "TEST-EV-702",
        subjectId: "TEST-SUBJ-1",
        occurredAt: "2026-09-23T10:00:00Z",
        consentId: "TEST-CNS-12",
        purpose: "model_training",
        expiresAt: "2026-09-23T11:00:00Z",
      }),
    ],
    makeRequest({ evaluatedAt: "2026-09-23T11:00:00Z", purpose: "model_training" }),
  );
  assert.equal(evidence.decision, "denied");
  assert.equal(evidence.reason, "consent_expired");
});

// ---------- multiple active grants: choose latest ----------

test("multiple active grants choose the latest deterministically", () => {
  const evidence = evaluateConsent(
    [
      grantEvent({
        eventId: "TEST-EV-802",
        subjectId: "TEST-SUBJ-1",
        occurredAt: "2026-09-23T10:00:00Z",
        consentId: "TEST-CNS-13",
        purpose: "model_training",
      }),
      grantEvent({
        eventId: "TEST-EV-801",
        subjectId: "TEST-SUBJ-1",
        occurredAt: "2026-09-23T11:00:00Z",
        consentId: "TEST-CNS-14",
        purpose: "model_training",
      }),
    ],
    makeRequest({ evaluatedAt: "2026-09-23T12:00:00Z", purpose: "model_training" }),
  );
  assert.equal(evidence.decision, "allowed");
  assert.deepEqual(evidence.evidenceEventIds, ["TEST-EV-801"]);
});

// ---------- deterministic under shuffled input ----------

test("evaluation is deterministic under shuffled input order", () => {
  const events = [
    grantEvent({
      eventId: "TEST-EV-900",
      subjectId: "TEST-SUBJ-1",
      occurredAt: "2026-09-23T10:00:00Z",
      consentId: "TEST-CNS-15",
      purpose: "model_training",
    }),
    revokeEvent({
      eventId: "TEST-EV-901",
      subjectId: "TEST-SUBJ-1",
      occurredAt: "2026-09-23T10:30:00Z",
      consentId: "TEST-CNS-15",
      reason: "withdrawn",
    }),
    grantEvent({
      eventId: "TEST-EV-902",
      subjectId: "TEST-SUBJ-1",
      occurredAt: "2026-09-23T11:00:00Z",
      consentId: "TEST-CNS-16",
      purpose: "model_training",
    }),
  ];
  const request = makeRequest({
    evaluatedAt: "2026-09-23T12:00:00Z",
    purpose: "model_training",
  });
  const first = evaluateConsent(events, request);
  const second = evaluateConsent(shuffled(events), request);
  assert.deepEqual(second, first);
  assert.equal(first.decision, "allowed");
  assert.deepEqual(first.evidenceEventIds, ["TEST-EV-902"]);
});

// ---------- no mutation ----------

test("evaluation does not mutate input events or request", () => {
  const events = [
    grantEvent({
      eventId: "TEST-EV-1000",
      subjectId: "TEST-SUBJ-1",
      occurredAt: "2026-09-23T11:00:00Z",
      consentId: "TEST-CNS-17",
      purpose: "model_training",
    }),
  ];
  const request = makeRequest({ purpose: "model_training" });
  const eventsFrozen = structuredClone(events);
  const requestFrozen = structuredClone(request);
  evaluateConsent(events, request);
  assert.deepEqual(events, eventsFrozen);
  assert.deepEqual(request, requestFrozen);
});

test("evaluation does not mutate even when input array is sorted in place", () => {
  const events = [
    grantEvent({
      eventId: "TEST-EV-1003",
      subjectId: "TEST-SUBJ-1",
      occurredAt: "2026-09-23T11:00:00Z",
      consentId: "TEST-CNS-18",
      purpose: "model_training",
    }),
    revokeEvent({
      eventId: "TEST-EV-1001",
      subjectId: "TEST-SUBJ-1",
      occurredAt: "2026-09-23T11:30:00Z",
      consentId: "TEST-CNS-18",
      reason: "withdrawn",
    }),
  ];
  const before = structuredClone(events);
  const beforeOrder = events.map((e) => e.eventId).join(",");
  evaluateConsent(events, makeRequest({ purpose: "model_training" }));
  assert.deepEqual(events, before);
  assert.equal(events.map((e) => e.eventId).join(","), beforeOrder);
});

// ---------- duplicate eventId / duplicate consentId ----------

test("duplicate eventId is rejected", () => {
  const events = [
    grantEvent({
      eventId: "TEST-EV-1100",
      subjectId: "TEST-SUBJ-1",
      occurredAt: "2026-09-23T11:00:00Z",
      consentId: "TEST-CNS-19",
      purpose: "model_training",
    }),
    grantEvent({
      eventId: "TEST-EV-1100",
      subjectId: "TEST-SUBJ-1",
      occurredAt: "2026-09-23T11:05:00Z",
      consentId: "TEST-CNS-20",
      purpose: "model_training",
    }),
  ];
  assert.throws(
    () =>
      evaluateConsent(
        events,
        makeRequest({ purpose: "model_training" }),
      ),
    (err) => {
      assert.ok(err instanceof ConsentEvaluationError);
      assert.match(err.message, /duplicate eventId/i);
      return true;
    },
  );
});

test("duplicate consentId across two grants is rejected", () => {
  const events = [
    grantEvent({
      eventId: "TEST-EV-1200",
      subjectId: "TEST-SUBJ-1",
      occurredAt: "2026-09-23T10:00:00Z",
      consentId: "TEST-CNS-21",
      purpose: "model_training",
    }),
    grantEvent({
      eventId: "TEST-EV-1201",
      subjectId: "TEST-SUBJ-1",
      occurredAt: "2026-09-23T11:00:00Z",
      consentId: "TEST-CNS-21",
      purpose: "model_training",
    }),
  ];
  assert.throws(
    () =>
      evaluateConsent(
        events,
        makeRequest({ purpose: "model_training" }),
      ),
    (err) => {
      assert.ok(err instanceof ConsentEvaluationError);
      assert.match(err.message, /duplicate consentId/i);
      return true;
    },
  );
});

test("distinct consentIds are not treated as duplicates", () => {
  const evidence = evaluateConsent(
    [
      grantEvent({
        eventId: "TEST-EV-1210",
        subjectId: "TEST-SUBJ-1",
        occurredAt: "2026-09-23T10:00:00Z",
        consentId: "TEST-CNS-22",
        purpose: "model_training",
      }),
      grantEvent({
        eventId: "TEST-EV-1211",
        subjectId: "TEST-SUBJ-1",
        occurredAt: "2026-09-23T10:30:00Z",
        consentId: "TEST-CNS-23",
        purpose: "model_training",
      }),
    ],
    makeRequest({ purpose: "model_training" }),
  );
  assert.equal(evidence.decision, "allowed");
});

// ---------- malformed / unknown payload fields ----------

test("grant payload with unknown field is rejected without leaking the value", () => {
  const events = [
    makeConsentEvent({
      eventId: "TEST-EV-1300",
      subjectId: "TEST-SUBJ-1",
      eventType: "consent_granted",
      occurredAt: "2026-09-23T11:00:00Z",
      payload: {
        consentId: "TEST-CNS-24",
        purpose: "model_training",
        surpriseValue: "SECRET-TOKEN-xyz",
      },
    }),
  ];
  assert.throws(
    () => evaluateConsent(events, makeRequest({ purpose: "model_training" })),
    (err) => {
      assert.ok(err instanceof ConsentEvaluationError);
      assert.doesNotMatch(err.message, /SECRET-TOKEN-xyz/);
      return true;
    },
  );
});

test("grant payload missing purpose is rejected without leaking consentId", () => {
  const events = [
    makeConsentEvent({
      eventId: "TEST-EV-1301",
      subjectId: "TEST-SUBJ-1",
      eventType: "consent_granted",
      occurredAt: "2026-09-23T11:00:00Z",
      payload: { consentId: "TEST-CNS-25" },
    }),
  ];
  assert.throws(
    () => evaluateConsent(events, makeRequest({ purpose: "model_training" })),
    (err) => {
      assert.ok(err instanceof ConsentEvaluationError);
      assert.doesNotMatch(err.message, /TEST-CNS-25/);
      return true;
    },
  );
});

test("grant payload with invalid expiresAt is rejected without leaking the value", () => {
  const events = [
    makeConsentEvent({
      eventId: "TEST-EV-1302",
      subjectId: "TEST-SUBJ-1",
      eventType: "consent_granted",
      occurredAt: "2026-09-23T11:00:00Z",
      payload: {
        consentId: "TEST-CNS-26",
        purpose: "model_training",
        expiresAt: "not-a-date-XYZ",
      },
    }),
  ];
  assert.throws(
    () => evaluateConsent(events, makeRequest({ purpose: "model_training" })),
    (err) => {
      assert.ok(err instanceof ConsentEvaluationError);
      assert.doesNotMatch(err.message, /not-a-date-XYZ/);
      return true;
    },
  );
});

test("grant payload with unknown purpose is rejected without leaking the value", () => {
  const events = [
    makeConsentEvent({
      eventId: "TEST-EV-1303",
      subjectId: "TEST-SUBJ-1",
      eventType: "consent_granted",
      occurredAt: "2026-09-23T11:00:00Z",
      payload: {
        consentId: "TEST-CNS-27",
        purpose: "unknown PURPOSE-VAL",
      },
    }),
  ];
  assert.throws(
    () => evaluateConsent(events, makeRequest({ purpose: "model_training" })),
    (err) => {
      assert.ok(err instanceof ConsentEvaluationError);
      assert.doesNotMatch(err.message, /PURPOSE-VAL/);
      return true;
    },
  );
});

test("revocation payload with unknown field is rejected without leaking the reason", () => {
  const events = [
    makeConsentEvent({
      eventId: "TEST-EV-1304",
      subjectId: "TEST-SUBJ-1",
      eventType: "consent_revoked",
      occurredAt: "2026-09-23T11:30:00Z",
      payload: {
        consentId: "TEST-CNS-28",
        reason: "SECRET-reason-abc",
        extra: "leak",
      },
    }),
  ];
  assert.throws(
    () => evaluateConsent(events, makeRequest({ purpose: "model_training" })),
    (err) => {
      assert.ok(err instanceof ConsentEvaluationError);
      assert.doesNotMatch(err.message, /SECRET-reason-abc/);
      assert.doesNotMatch(err.message, /leak/);
      return true;
    },
  );
});

test("revocation payload missing reason is rejected without leaking consentId", () => {
  const events = [
    makeConsentEvent({
      eventId: "TEST-EV-1305",
      subjectId: "TEST-SUBJ-1",
      eventType: "consent_revoked",
      occurredAt: "2026-09-23T11:30:00Z",
      payload: { consentId: "TEST-CNS-29" },
    }),
  ];
  assert.throws(
    () => evaluateConsent(events, makeRequest({ purpose: "model_training" })),
    (err) => {
      assert.ok(err instanceof ConsentEvaluationError);
      assert.doesNotMatch(err.message, /TEST-CNS-29/);
      return true;
    },
  );
});

test("grant payload that is not a plain object (array) is rejected", () => {
  const events = [
    makeConsentEvent({
      eventId: "TEST-EV-1306",
      subjectId: "TEST-SUBJ-1",
      eventType: "consent_granted",
      occurredAt: "2026-09-23T11:00:00Z",
      payload: ["consentId", "value"],
    }),
  ];
  assert.throws(
    () => evaluateConsent(events, makeRequest({ purpose: "model_training" })),
    ConsentEvaluationError,
  );
});

// ---------- hardening: regression tests ----------

test("duplicate eventId on wrong subject is ignored", () => {
  const events = [
    grantEvent({
      eventId: "TEST-EV-1400",
      subjectId: "TEST-SUBJ-1",
      occurredAt: "2026-09-23T11:00:00Z",
      consentId: "TEST-CNS-100",
      purpose: "model_training",
    }),
    grantEvent({
      eventId: "TEST-EV-1100",
      subjectId: "TEST-SUBJ-OTHER",
      occurredAt: "2026-09-23T11:05:00Z",
      consentId: "TEST-CNS-101",
      purpose: "model_training",
    }),
  ];
  const evidence = evaluateConsent(
    events,
    makeRequest({ purpose: "model_training" }),
  );
  assert.equal(evidence.decision, "allowed");
  assert.deepEqual(evidence.evidenceEventIds, ["TEST-EV-1400"]);
});

test("duplicate eventId in a future event is ignored", () => {
  const events = [
    grantEvent({
      eventId: "TEST-EV-1500",
      subjectId: "TEST-SUBJ-1",
      occurredAt: "2026-09-23T11:00:00Z",
      consentId: "TEST-CNS-110",
      purpose: "model_training",
    }),
    grantEvent({
      eventId: "TEST-EV-1100",
      subjectId: "TEST-SUBJ-1",
      occurredAt: "2026-09-23T13:00:00Z",
      consentId: "TEST-CNS-111",
      purpose: "model_training",
    }),
  ];
  const evidence = evaluateConsent(
    events,
    makeRequest({ evaluatedAt: "2026-09-23T12:00:00Z", purpose: "model_training" }),
  );
  assert.equal(evidence.decision, "allowed");
  assert.deepEqual(evidence.evidenceEventIds, ["TEST-EV-1500"]);
});

test("future malformed payload is ignored", () => {
  const events = [
    grantEvent({
      eventId: "TEST-EV-1600",
      subjectId: "TEST-SUBJ-1",
      occurredAt: "2026-09-23T11:00:00Z",
      consentId: "TEST-CNS-120",
      purpose: "model_training",
    }),
    makeConsentEvent({
      eventId: "TEST-EV-1601",
      subjectId: "TEST-SUBJ-1",
      eventType: "consent_granted",
      occurredAt: "2026-09-23T13:00:00Z",
      payload: { consentId: "BAD-CONSENT-ID", purpose: "BAD-PURPOSE" },
    }),
  ];
  const evidence = evaluateConsent(
    events,
    makeRequest({ evaluatedAt: "2026-09-23T12:00:00Z", purpose: "model_training" }),
  );
  assert.equal(evidence.decision, "allowed");
  assert.deepEqual(evidence.evidenceEventIds, ["TEST-EV-1600"]);
});

test("missing recordedAt on an applicable event fails", () => {
  const events = [
    makeConsentEvent({
      eventId: "TEST-EV-1700",
      subjectId: "TEST-SUBJ-1",
      eventType: "consent_granted",
      occurredAt: "2026-09-23T11:00:00Z",
      recordedAt: undefined,
      payload: { consentId: "TEST-CNS-130", purpose: "model_training" },
    }),
  ];
  // Override recordedAt to be absent entirely
  delete events[0].recordedAt;
  assert.throws(
    () => evaluateConsent(events, makeRequest({ purpose: "model_training" })),
    (err) => {
      assert.ok(err instanceof ConsentEvaluationError);
      assert.match(err.message, /recordedAt/i);
      return true;
    },
  );
});

test("whitespace/control eventId fails", () => {
  const events = [
    makeConsentEvent({
      eventId: "  TEST-EV-1800  ",
      subjectId: "TEST-SUBJ-1",
      eventType: "consent_granted",
      occurredAt: "2026-09-23T11:00:00Z",
      payload: { consentId: "TEST-CNS-140", purpose: "model_training" },
    }),
  ];
  assert.throws(
    () => evaluateConsent(events, makeRequest({ purpose: "model_training" })),
    ConsentEvaluationError,
  );
});

test("expiresAt <= grant occurredAt fails", () => {
  const events = [
    makeConsentEvent({
      eventId: "TEST-EV-1900",
      subjectId: "TEST-SUBJ-1",
      eventType: "consent_granted",
      occurredAt: "2026-09-23T11:00:00Z",
      payload: {
        consentId: "TEST-CNS-150",
        purpose: "model_training",
        expiresAt: "2026-09-23T11:00:00Z",
      },
    }),
  ];
  assert.throws(
    () => evaluateConsent(events, makeRequest({ purpose: "model_training" })),
    (err) => {
      assert.ok(err instanceof ConsentEvaluationError);
      assert.match(err.message, /expiresAt/i);
      return true;
    },
  );
});

test("sub-millisecond future grant is ignored correctly", () => {
  const events = [
    grantEvent({
      eventId: "TEST-EV-2000",
      subjectId: "TEST-SUBJ-1",
      occurredAt: "2026-09-23T11:00:00.000000001Z",
      consentId: "TEST-CNS-160",
      purpose: "model_training",
    }),
  ];
  const evidence = evaluateConsent(
    events,
    makeRequest({ evaluatedAt: "2026-09-23T11:00:00Z", purpose: "model_training" }),
  );
  // Grant at 11:00:00.000000001 is 1 ns after evaluatedAt 11:00:00, so it is
  // a future event and must be ignored.
  assert.equal(evidence.decision, "denied");
  assert.equal(evidence.reason, "no_matching_consent");
});

test("sub-millisecond expiration boundary is exact", () => {
  // Grant at 10:00:00, expires at 11:00:00.000000001 (one nanosecond later).
  // evaluatedAt at exactly 11:00:00 is before the expiration, so the grant is
  // still active.
  {
    const events = [
      grantEvent({
        eventId: "TEST-EV-2100",
        subjectId: "TEST-SUBJ-1",
        occurredAt: "2026-09-23T10:00:00Z",
        consentId: "TEST-CNS-170",
        purpose: "model_training",
        expiresAt: "2026-09-23T11:00:00.000000001Z",
      }),
    ];
    const evidence = evaluateConsent(
      events,
      makeRequest({ evaluatedAt: "2026-09-23T11:00:00Z", purpose: "model_training" }),
    );
    assert.equal(evidence.decision, "allowed");
    assert.equal(evidence.reason, "active_consent");
  }
  // evaluatedAt at exactly 11:00:00.000000001 is at the expiration boundary,
  // so the grant is expired (evaluatedAt >= expiresAt -> not < expiresAt).
  {
    const events = [
      grantEvent({
        eventId: "TEST-EV-2101",
        subjectId: "TEST-SUBJ-1",
        occurredAt: "2026-09-23T10:00:00Z",
        consentId: "TEST-CNS-171",
        purpose: "model_training",
        expiresAt: "2026-09-23T11:00:00.000000001Z",
      }),
    ];
    const evidence = evaluateConsent(
      events,
      makeRequest({ evaluatedAt: "2026-09-23T11:00:00.000000001Z", purpose: "model_training" }),
    );
    assert.equal(evidence.decision, "denied");
    assert.equal(evidence.reason, "consent_expired");
  }
});

test("sub-millisecond grant/revoke ordering is exact", () => {
  // Grant at 11:00:00.000000001, revoke at 11:00:00.000000002.
  // At evaluatedAt 11:00:00, neither occurred yet -> denial.
  {
    const events = [
      grantEvent({
        eventId: "TEST-EV-2200",
        subjectId: "TEST-SUBJ-1",
        occurredAt: "2026-09-23T11:00:00.000000001Z",
        consentId: "TEST-CNS-180",
        purpose: "model_training",
      }),
      revokeEvent({
        eventId: "TEST-EV-2201",
        subjectId: "TEST-SUBJ-1",
        occurredAt: "2026-09-23T11:00:00.000000002Z",
        consentId: "TEST-CNS-180",
        reason: "withdrawn",
      }),
    ];
    const evidence = evaluateConsent(
      events,
      makeRequest({ evaluatedAt: "2026-09-23T11:00:00Z", purpose: "model_training" }),
    );
    assert.equal(evidence.decision, "denied");
    assert.equal(evidence.reason, "no_matching_consent");
  }
  // At evaluatedAt 11:00:00.000000001, grant just occurred but revoke (at .002)
  // is still in the future -> allowed.
  {
    const events = [
      grantEvent({
        eventId: "TEST-EV-2210",
        subjectId: "TEST-SUBJ-1",
        occurredAt: "2026-09-23T11:00:00.000000001Z",
        consentId: "TEST-CNS-181",
        purpose: "model_training",
      }),
      revokeEvent({
        eventId: "TEST-EV-2211",
        subjectId: "TEST-SUBJ-1",
        occurredAt: "2026-09-23T11:00:00.000000002Z",
        consentId: "TEST-CNS-181",
        reason: "withdrawn",
      }),
    ];
    const evidence = evaluateConsent(
      events,
      makeRequest({ evaluatedAt: "2026-09-23T11:00:00.000000001Z", purpose: "model_training" }),
    );
    assert.equal(evidence.decision, "allowed");
    assert.equal(evidence.reason, "active_consent");
  }
  // At evaluatedAt 11:00:00.000000002, both grant and revoke have occurred
  // -> revoked.
  {
    const events = [
      grantEvent({
        eventId: "TEST-EV-2220",
        subjectId: "TEST-SUBJ-1",
        occurredAt: "2026-09-23T11:00:00.000000001Z",
        consentId: "TEST-CNS-182",
        purpose: "model_training",
      }),
      revokeEvent({
        eventId: "TEST-EV-2221",
        subjectId: "TEST-SUBJ-1",
        occurredAt: "2026-09-23T11:00:00.000000002Z",
        consentId: "TEST-CNS-182",
        reason: "withdrawn",
      }),
    ];
    const evidence = evaluateConsent(
      events,
      makeRequest({ evaluatedAt: "2026-09-23T11:00:00.000000002Z", purpose: "model_training" }),
    );
    assert.equal(evidence.decision, "denied");
    assert.equal(evidence.reason, "consent_revoked");
    assert.deepEqual(evidence.evidenceEventIds, ["TEST-EV-2220", "TEST-EV-2221"]);
  }
});

test("unknown request field fails", () => {
  const request = {
    subjectId: "TEST-SUBJ-1",
    dataClassification: "identified",
    purpose: "model_training",
    evaluatedAt: "2026-09-23T12:00:00Z",
    extraField: "should-not-be-here",
  };
  assert.throws(
    () => evaluateConsent([], request),
    (err) => {
      assert.ok(err instanceof ConsentEvaluationError);
      assert.match(err.message, /unknown field/i);
      return true;
    },
  );
});

test("module runtime exports contain only ConsentEvaluationError and evaluateConsent", async () => {
  const module = await import("../src/consent.ts");
  const keys = Object.keys(module).sort();
  assert.deepEqual(keys, ["ConsentEvaluationError", "evaluateConsent"]);
});

// ---------- payload strict-string error context (regression) ----------

test("malformed grant consentId produces a contextual ConsentEvaluationError", () => {
  const events = [
    makeConsentEvent({
      eventId: "TEST-EV-1310",
      subjectId: "TEST-SUBJ-1",
      eventType: "consent_granted",
      occurredAt: "2026-09-23T11:00:00Z",
      payload: {
        consentId: " BAD-CNS-LEAK-XYZ",
        purpose: "model_training",
      },
    }),
  ];
  assert.throws(
    () => evaluateConsent(events, makeRequest({ purpose: "model_training" })),
    (err) => {
      assert.ok(err instanceof ConsentEvaluationError);
      assert.match(err.message, /events\[0\]/);
      assert.match(err.message, /consentId/);
      assert.doesNotMatch(err.message, /BAD-CNS-LEAK-XYZ/);
      return true;
    },
  );
});

test("malformed revocation consentId produces a contextual ConsentEvaluationError", () => {
  const events = [
    makeConsentEvent({
      eventId: "TEST-EV-1311",
      subjectId: "TEST-SUBJ-1",
      eventType: "consent_revoked",
      occurredAt: "2026-09-23T11:30:00Z",
      payload: {
        consentId: " BAD-REV-CNS-LEAK-ABC",
        reason: "withdrawn",
      },
    }),
  ];
  assert.throws(
    () => evaluateConsent(events, makeRequest({ purpose: "model_training" })),
    (err) => {
      assert.ok(err instanceof ConsentEvaluationError);
      assert.match(err.message, /events\[0\]/);
      assert.match(err.message, /consentId/);
      assert.doesNotMatch(err.message, /BAD-REV-CNS-LEAK-ABC/);
      return true;
    },
  );
});

test("malformed revocation reason produces a contextual ConsentEvaluationError", () => {
  const events = [
    makeConsentEvent({
      eventId: "TEST-EV-1312",
      subjectId: "TEST-SUBJ-1",
      eventType: "consent_revoked",
      occurredAt: "2026-09-23T11:30:00Z",
      payload: {
        consentId: "TEST-CNS-30",
        reason: "BAD-REASON-LEAK-QRS ",
      },
    }),
  ];
  assert.throws(
    () => evaluateConsent(events, makeRequest({ purpose: "model_training" })),
    (err) => {
      assert.ok(err instanceof ConsentEvaluationError);
      assert.match(err.message, /events\[0\]/);
      assert.match(err.message, /reason/);
      assert.doesNotMatch(err.message, /BAD-REASON-LEAK-QRS/);
      return true;
    },
  );
});
