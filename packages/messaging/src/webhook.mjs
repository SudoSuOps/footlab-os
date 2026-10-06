import { createHmac, timingSafeEqual } from 'node:crypto';

// Twilio application/x-www-form-urlencoded POST only; not JSON or WebSocket signatures.
// Pass the configured PUBLIC URL, never a URL assembled from untrusted proxy headers.
export function verifyTwilioFormSignature({ publicUrl, authToken, form, signature }) {
  if (!authToken || typeof signature !== 'string' || !(form instanceof URLSearchParams)) return false;
  let url;
  try { url = new URL(publicUrl); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.searchParams.has('bodySHA256')) return false;
  const keys = [...form.keys()];
  // Fail closed on multi-valued fields; use the official SDK if this is required.
  if (new Set(keys).size !== keys.length) return false;
  const data = publicUrl + keys.sort().map(key => key + form.get(key)).join('');
  const expected = Buffer.from(createHmac('sha1', authToken).update(data).digest('base64'));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
