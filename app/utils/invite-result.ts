/** What the invite endpoint reports back. */
export interface InviteResult {
  emailSent: boolean
  /** Present when the email could not be sent, so the inviter can pass it on by hand. */
  inviteUrl?: string
}

/**
 * The link the inviter has to share themselves, or null when the email went out
 * (or there is nothing to share).
 */
export function inviteLinkToShare(result: InviteResult | null | undefined): string | null {
  if (!result || result.emailSent) return null
  return result.inviteUrl ? result.inviteUrl : null
}
