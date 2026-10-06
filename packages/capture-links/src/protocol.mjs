export const PROTOCOL_ID = "flo-bilateral-v2";
export const CAPTURE_STEPS = Object.freeze(
  [
    {
      id: "right-top",
      foot: "Right",
      view: "Top",
      hint: "Show the whole top of your right foot, from toes to ankle.",
    },
    {
      id: "right-sides",
      foot: "Right",
      view: "Sides",
      hint: "Take a clear side view of your right foot. Use an extra photo for the opposite side.",
    },
    {
      id: "right-plantar",
      foot: "Right",
      view: "Bottom",
      hint: "Show the full sole of your right foot. Get help if positioning is difficult.",
    },
    {
      id: "left-top",
      foot: "Left",
      view: "Top",
      hint: "Show the whole top of your left foot, from toes to ankle.",
    },
    {
      id: "left-sides",
      foot: "Left",
      view: "Sides",
      hint: "Take a clear side view of your left foot. Use an extra photo for the opposite side.",
    },
    {
      id: "left-plantar",
      foot: "Left",
      view: "Bottom",
      hint: "Show the full sole of your left foot. Get help if positioning is difficult.",
    },
  ].map(Object.freeze),
);
export const EXTRA_SLOTS = Object.freeze([
  "extra-1",
  "extra-2",
  "extra-3",
  "extra-4",
]);
export const ALL_SLOTS = Object.freeze([
  ...CAPTURE_STEPS.map((s) => s.id),
  ...EXTRA_SLOTS,
]);
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export function validateCheckIn(value) {
  if (
    !value ||
    !["yes", "no", "unsure"].includes(value.meaningfulChange) ||
    typeof value.note !== "string" ||
    value.note.length > 500
  )
    throw new Error(
      "Answer the change question; notes must be 500 characters or fewer.",
    );
  return { meaningfulChange: value.meaningfulChange, note: value.note.trim() };
}
export function validateCompletion(value, uploads) {
  if (
    !value ||
    value.protocolId !== PROTOCOL_ID ||
    !Array.isArray(value.slots) ||
    value.slots.length < 6 ||
    value.slots.length > 10 ||
    new Set(value.slots).size !== value.slots.length ||
    value.slots.some((s) => !ALL_SLOTS.includes(s)) ||
    CAPTURE_STEPS.some((s) => !value.slots.includes(s.id))
  )
    throw new Error("Six required photos and up to four extras are needed.");
  for (const slot of value.slots)
    if (!uploads[slot])
      throw new Error("Wait for every selected photo to finish uploading.");
  return {
    protocolId: PROTOCOL_ID,
    slots: [...value.slots].sort(),
    checkIn: validateCheckIn(value.checkIn),
  };
}
