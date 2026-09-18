export type Id = string;
export type ISODateTime = string;

export type ActorType =
  | "client"
  | "operator"
  | "clinical_reviewer"
  | "manufacturing"
  | "system"
  | "model";

export type FootSide = "left" | "right";

export type FlightEventType =
  | "capture_requested"
  | "sms_queued"
  | "sms_sent"
  | "sms_delivered"
  | "sms_failed"
  | "capture_link_opened"
  | "capture_started"
  | "capture_completed"
  | "capture_ready_for_ingest"
  | "capture_ingested"
  | "observation_created"
  | "change_flagged"
  | "operator_reviewed"
  | "clinical_review_requested"
  | "clinical_review_recorded"
  | "client_message_sent"
  | "design_requirement_created"
  | "design_version_created"
  | "fabrication_started"
  | "fabrication_qa_recorded"
  | "device_delivered"
  | "wear_feedback_recorded"
  | "adjustment_requested"
  | "consent_changed";

export interface ActorRef {
  type: ActorType;
  id: Id;
}

export interface FlightEvent<T = Record<string, unknown>> {
  id: Id;
  clientId: Id;
  occurredAt: ISODateTime;
  type: FlightEventType;
  actor: ActorRef;
  source: string;
  payload: T;
  modelVersion?: string;
  supersedesEventId?: Id;
}

export interface CaptureSession {
  id: Id;
  clientId: Id;
  issuedAt: ISODateTime;
  expiresAt: ISODateTime;
  status: "issued" | "started" | "completed" | "expired" | "revoked";
  requiredViews: CaptureView[];
}

export interface CaptureView {
  id: Id;
  side: FootSide;
  view: "dorsal" | "plantar" | "medial" | "lateral" | "targeted";
  status: "required" | "captured" | "accepted" | "retry";
  mediaObjectId?: Id;
  qualityReasons?: string[];
}

export interface Observation {
  id: Id;
  clientId: Id;
  captureSessionId: Id;
  side: FootSide;
  createdAt: ISODateTime;
  author: ActorRef;
  facts: Record<string, string | number | boolean | null>;
  uncertainty?: string[];
  comparableBaselineEventIds: Id[];
  requiresHumanReview: boolean;
  routingReasons: string[];
}

export interface DesignRequirement {
  id: Id;
  clientId: Id;
  createdAt: ISODateTime;
  createdBy: ActorRef;
  sourceEventIds: Id[];
  state: "draft" | "approved" | "in_design" | "fabricating" | "delivered" | "superseded";
  requirement: string;
  constraints: string[];
}
