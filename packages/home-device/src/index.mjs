const ID = /^[A-Za-z0-9_-]{1,64}$/;
const KEYS = ['version', 'deviceId', 'bootId', 'sequence', 'type', 'uptimeMs'];

export function validateHomeEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !KEYS.includes(key)) || Object.keys(value).length !== KEYS.length
    || value.version !== 1 || typeof value.deviceId !== "string" || typeof value.bootId !== "string"
    || !ID.test(value.deviceId) || !ID.test(value.bootId)
    || !Number.isSafeInteger(value.sequence) || value.sequence < 0
    || !Number.isSafeInteger(value.uptimeMs) || value.uptimeMs < 0
    || !['heartbeat', 'checkin_requested'].includes(value.type)) {
    throw new Error('Invalid FLO Home event');
  }
  return Object.freeze({ ...value });
}

// Caller authenticates the paired device first. State must be persisted on Edge.
// A new boot session is established explicitly by Edge, never by an incoming event.
export function createHomeSession(deviceId, bootId) {
  if (typeof deviceId !== 'string' || typeof bootId !== 'string' || !ID.test(deviceId) || !ID.test(bootId)) throw new Error('Invalid device session');
  return Object.freeze({ deviceId, bootId, lastSequence: -1, lastUptimeMs: 0, lastSeenAt: null });
}

export function acceptHomeEvent(session, raw, receivedAt = new Date()) {
  const event = validateHomeEvent(raw);
  if (event.deviceId !== session.deviceId || event.bootId !== session.bootId) throw new Error('Device session mismatch');
  if (event.sequence <= session.lastSequence || event.uptimeMs < session.lastUptimeMs) throw new Error('Stale device event');
  if (!Number.isFinite(receivedAt.getTime())) throw new Error('Invalid receipt time');
  return Object.freeze({
    session: Object.freeze({ ...session, lastSequence: event.sequence, lastUptimeMs: event.uptimeMs, lastSeenAt: receivedAt.toISOString() }),
    // Intent only: Edge still checks consent, eligibility and throttling before issuing SMS.
    intent: event.type === 'checkin_requested' ? 'request_checkin' : null,
  });
}
