/** Only loopback hosts may bypass hosted sign-in during local development. */
export function isLocalDevelopmentHost(value: string | null): boolean {
  if (!value) return false;
  const firstHost = value.split(",")[0]?.trim();
  if (!firstHost) return false;
  try {
    const hostname = new URL(`http://${firstHost}`).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}
