/**
 * Party size — how many people the plan is actually for.
 *
 * Nothing in the trip data used to record this, so every AI path quietly
 * defaulted to a party of two and then stated the guess as if it had been
 * given: a production chat quoted a 4-day cash budget "for two" on a trip whose
 * party size had never been set anywhere, and only owned up to the assumption
 * when the traveler asked where the number came from.
 *
 * The fix is to make the number explicit where it is known and the *absence*
 * explicit where it is not, so the model states an assumption instead of
 * asserting one. Three sources, in order:
 *
 *  1. `preferences.partySize` — set by the traveler on the new-trip form or in
 *     trip settings. A fact; optional, because most travelers won't fill it in.
 *  2. The people on the trip in the app — the owner plus accepted and pending
 *     invites. Used only when someone has actually been invited: a trip with no
 *     invites says nothing about party size (plenty of couples plan from one
 *     account), so a lone owner is NOT read as "travelling alone".
 *  3. Nothing. The model may still infer a number — that is often the only way
 *     to answer at all — but it has to say which number it inferred.
 *
 * This module is deliberately free of database imports so `server/lib/ai.ts`
 * and the prompt builders can use it. The member-count query that feeds source
 * 2 lives in `server/lib/trips.ts`.
 */

/** Where a resolved party size came from — drives how firmly the prompt states it. */
export type PartySizeSource = "setting" | "members" | "unknown"

export interface ResolvedPartySize {
  /** Headcount, or null when nothing in the trip data implies one. */
  size: number | null
  source: PartySizeSource
}

export const PARTY_SIZE_MIN = 1

/**
 * Upper bound on a party size, applied both by the request schema and by
 * `clampPartySize` when reading stored values.
 *
 * `preferences` is a jsonb column, so a row written before this field existed —
 * or by anything other than the validated endpoints — can hold any JSON at all.
 * A `partySize` of 1e9 reaching a prompt as "1000000000 travelers" is worse
 * than no party size, hence the clamp on the read path rather than trust in
 * the write path.
 */
export const PARTY_SIZE_MAX = 50

/**
 * Coerce a stored/claimed party size into the supported range, or null when it
 * is not a usable headcount at all. Fractional values round down — "2.5 people"
 * is a data error, and 2 is the safer reading of it than 3.
 */
export function clampPartySize(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null
  const n = Math.floor(value)
  if (n < PARTY_SIZE_MIN) return null
  return Math.min(n, PARTY_SIZE_MAX)
}

export function resolvePartySize(input: {
  /** `trips.preferences.partySize` — the traveler's explicit setting. */
  partySize?: number | null
  /** Owner + accepted/pending invites. See `countTripParticipants`. */
  memberCount?: number | null
}): ResolvedPartySize {
  const setting = clampPartySize(input.partySize)
  if (setting != null) return { size: setting, source: "setting" }

  // >= 2 only: a member count of 1 is just "nobody has been invited", which is
  // the default state of every solo-planned trip and carries no signal about
  // who is actually going. Treating it as "1 traveler" would replace the old
  // silent guess of two with an equally silent guess of one.
  const members = clampPartySize(input.memberCount)
  if (members != null && members >= 2) return { size: members, source: "members" }

  return { size: null, source: "unknown" }
}

/**
 * Render the party-size block for an AI prompt.
 *
 * `guideWhenUnknown` is for conversational surfaces (the discuss agent), where
 * the model answers in prose and can volunteer its assumption. Generation
 * prompts leave it off: they emit structured activities, have no way to caveat
 * anything, and would only pay tokens for advice they cannot follow.
 */
export function buildPartySizeCtx(
  party: ResolvedPartySize,
  opts: { guideWhenUnknown?: boolean } = {},
): string {
  if (party.size == null) {
    if (!opts.guideWhenUnknown) return ""
    return `\nPARTY SIZE: not recorded for this trip. Do NOT pick a number silently and then present it as if the traveler had given it. When an answer depends on headcount — total costs, cash to carry, room or ticket counts, table sizes, vehicle choice — name the number you are assuming in the same breath as the answer and invite the traveler to correct it.`
  }

  const people = `${party.size} ${party.size === 1 ? "traveler" : "travelers"}`
  const provenance =
    party.source === "setting"
      ? "set by the traveler in trip settings — treat this as a hard fact, not a guess"
      : "inferred from the people on this trip in the app — reliable enough to plan on, but say so if an answer leans on it"

  return `\nPARTY SIZE: ${people} (${provenance}). Size anything that scales with headcount for exactly ${party.size}: total costs and cash to carry, room and ticket counts, restaurant table sizes, and vehicle choice. Per-activity costEstimate values stay PER PERSON — do not multiply them by the party size; multiply only when you quote a total, and say that it is a total for ${people}.`
}
