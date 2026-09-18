import type { FlightEvent, Id } from "../../domain/src/index";

export interface FlightSheetSnapshot {
  clientId: Id;
  generatedAt: string;
  latestEventAt?: string;
  openActions: Array<{ id: Id; owner: string; nextStep: string; dueAt?: string }>;
  currentDeviceVersion?: string;
  eventCount: number;
}

/**
 * V1 invariant: a Flight Sheet is derived from ordered canonical events.
 * This function intentionally stays deterministic and side-effect free.
 */
export function buildFlightSheetSnapshot(
  clientId: Id,
  events: FlightEvent[],
  generatedAt: string,
): FlightSheetSnapshot {
  const clientEvents = events
    .filter((event) => event.clientId === clientId)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  return {
    clientId,
    generatedAt,
    latestEventAt: clientEvents.at(-1)?.occurredAt,
    openActions: [],
    eventCount: clientEvents.length,
  };
}
