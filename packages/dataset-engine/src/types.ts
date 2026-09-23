import type { ActorRef, FootSide, Id, ISODateTime } from "../../domain/src/index";

export type JSONPrimitive = string | number | boolean | null;
export type JSONValue = JSONPrimitive | JSONObject | JSONArray;
export interface JSONObject {
  readonly [key: string]: JSONValue;
}
export type JSONArray = readonly JSONValue[];

export type DataClassification = "synthetic" | "identified" | "pseudonymized";

export type DatasetEventType =
  | "consent_granted"
  | "consent_revoked"
  | "flight_event_recorded"
  | "capture_recorded"
  | "observation_recorded"
  | "design_released"
  | "build_verified"
  | "fit_recorded"
  | "follow_up_recorded"
  | "outcome_recorded"
  | "artifact_superseded";

export type ConsentPurpose =
  | "care_operations"
  | "care_team_sharing"
  | "quality_improvement"
  | "model_evaluation"
  | "model_training"
  | "research_publication";

export type ArtifactKind = "image" | "observation" | "design" | "build" | "fit" | "other";

export interface ArtifactReference {
  readonly artifactId: Id;
  readonly artifactKind: ArtifactKind;
  readonly relativeUri: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly createdAt: ISODateTime;
}

export interface DatasetEventSource {
  readonly producerName: string;
  readonly producerVersion: string;
  readonly sourceEventId?: Id;
}

export interface ConsentEvidence {
  readonly decision: "allowed" | "denied" | "synthetic_exemption";
  readonly purpose?: ConsentPurpose;
  readonly evaluatedAt: ISODateTime;
  readonly evidenceEventIds: readonly Id[];
  readonly reason: string;
}

export interface Provenance {
  readonly inputEventIds: readonly Id[];
  readonly supersededEventId?: Id;
}

export interface Integrity {
  readonly algorithm: "sha256";
  readonly contentHash: string;
  readonly previousEventHash?: string;
}

export interface DatasetEvent<TPayload extends JSONValue = JSONObject> {
  readonly schemaVersion: "1.0.0";
  readonly eventId: Id;
  readonly caseId: Id;
  readonly subjectId: Id;
  readonly eventType: DatasetEventType;
  readonly occurredAt: ISODateTime;
  readonly recordedAt: ISODateTime;
  readonly footSide?: FootSide;
  readonly actor: ActorRef;
  readonly dataClassification: DataClassification;
  readonly source: DatasetEventSource;
  readonly consentEvidence: ConsentEvidence;
  readonly artifactReferences: readonly ArtifactReference[];
  readonly provenance: Provenance;
  readonly payload: TPayload;
  readonly integrity: Integrity;
  readonly correlationId?: Id;
  readonly causationId?: Id;
}
