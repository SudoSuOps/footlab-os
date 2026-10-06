export function composeFloCheckinSms(captureUrl) {
  let url;
  try {
    url = new URL(captureUrl);
  } catch {
    throw new Error("Invalid capture URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/c\/[A-Za-z0-9_-]{43}$/.test(url.pathname)
  )
    throw new Error("Use an HTTPS capture link with an opaque token.");
  // Generic copy: no client name, condition, clinical result, or unverified expiry claim.
  return `FootLab: It's FLO time. Tap to start your foot check-in: ${url.href} No app or password. Reply STOP to opt out.`;
}
