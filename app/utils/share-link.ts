/**
 * Whether a trip's public link still works. The shared page refuses a token
 * past its expiry, so an expired token is the same as no link at all.
 */
export function isShareActive(
  token: string | null | undefined,
  expiresAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!token) return false
  if (expiresAt == null) return true
  const expiry = new Date(expiresAt).getTime()
  if (Number.isNaN(expiry)) return false
  return expiry > now.getTime()
}
