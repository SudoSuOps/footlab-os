import type { Id, ISODateTime } from "../../domain/src/index";

export interface EdgeApplianceIdentity {
  applianceId: Id;
  siteId: Id;
  softwareVersion: string;
  modelVersions: Record<string, string>;
}

export interface EdgeHealth {
  observedAt: ISODateTime;
  servicesHealthy: boolean;
  diskUsedPercent: number;
  vaultIntegrity: "ok" | "warning" | "error" | "unknown";
  pendingCaptureJobs: number;
  inferenceQueueDepth: number;
  backupState: "disabled" | "ok" | "degraded" | "failed";
  lastAuditCheckpointAt?: ISODateTime;
  clockDriftSeconds?: number;
}

export interface ConsentScope {
  id: Id;
  clientId: Id;
  purpose: string;
  recipients: string[];
  dataClasses: string[];
  grantedAt: ISODateTime;
  expiresAt?: ISODateTime;
  revokedAt?: ISODateTime;
}
