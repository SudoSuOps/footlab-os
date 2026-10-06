export const CAPTURE_VIEWS = Object.freeze(['right-plantar', 'left-plantar', 'right-targeted', 'left-targeted']);
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

// Metadata validation only. A production upload service must inspect actual bytes.
export function validateCaptureSubmission(value) {
  const invalid = () => { throw new Error('Add four distinct supported photos and answer the change question.'); };
  if (!value || !Array.isArray(value.captures) || value.captures.length !== CAPTURE_VIEWS.length) invalid();
  const seen = new Set();
  const captures = value.captures.map(c => {
    if (!c || !CAPTURE_VIEWS.includes(c.viewId) || seen.has(c.viewId) || !MIME_TYPES.has(c.mimeType)
      || !Number.isSafeInteger(c.size) || c.size <= 0 || c.size > MAX_IMAGE_BYTES) invalid();
    seen.add(c.viewId);
    // Filenames can contain personal information; do not retain them.
    return { viewId: c.viewId, mimeType: c.mimeType, size: c.size };
  });
  const checkIn = value.checkIn;
  if (!checkIn || !['yes', 'no', 'unsure'].includes(checkIn.meaningfulChange)
    || typeof checkIn.note !== 'string' || checkIn.note.length > 500) invalid();
  return { captures, checkIn: { meaningfulChange: checkIn.meaningfulChange, note: checkIn.note.trim() } };
}
