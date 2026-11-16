/**
 * Post-login destination from a `callbackUrl` query parameter. Only same-site
 * relative paths are accepted (no "//host", no "/\\host", no scheme), so the
 * parameter cannot be used as an open redirect.
 */
export function safeCallbackPath(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw || typeof raw !== "string") return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(raw)) return fallback;
  try {
    const u = new URL(raw, "http://local.invalid");
    if (u.origin !== "http://local.invalid") return fallback;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return fallback;
  }
}
