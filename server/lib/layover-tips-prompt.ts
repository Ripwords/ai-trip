import { z } from "zod"
import { formatLayoverDuration } from "./ai-cache"

export const layoverTipsBodySchema = z.object({
  airport: z.string().min(2).max(4).toUpperCase(),
  /**
   * Null (or absent) when the connection length is unknown: the legs carry no
   * usable times, or they straddle a timezone the client cannot resolve. The
   * client used to send 180 in that case, which the prompt then presented as a
   * fact.
   */
  durationMinutes: z.number().int().positive().nullable().optional(),
  visaStatus: z.string().nullable(),
  /**
   * Wall clock at the layover airport, e.g. "2026-08-16 03:00+08:00".
   *
   * NOT the UTC `flights.arrivalTime`: that column is `timestamp with timezone`
   * and serialises with `Z`, and a UTC instant cannot say what the airport clock
   * read. Optional so a stale client bundle degrades to an "unknown" bucket
   * rather than a wrong one (issue #15).
   */
  arrivalTimeLocal: z.string().nullable().optional(),
})

export interface LayoverTipsPromptInput {
  airport: string
  durationMinutes: number | null
  visaStatus: string
  timeOfDay: string
}

export function buildLayoverTipsPrompt(input: LayoverTipsPromptInput): string {
  const { airport, durationMinutes, visaStatus, timeOfDay } = input
  const requiresAirportOnly = visaStatus === "visa_required" || visaStatus === "visa-required"
  const visaRule = requiresAirportOnly
    ? "VISA RESTRICTION: the traveler needs a visa for this country and likely cannot exit immigration. Focus ONLY on airside / transit-zone options."
    : ""

  if (durationMinutes === null) {
    return `You are a travel expert helping a traveler with a layover of unknown length at ${airport} (IATA airport code). Their flight times did not give a reliable connection time, so do not assume one.

Time of arrival (local): ${timeOfDay}
Visa status: ${visaStatus || "unknown"}

Provide practical, specific advice:
- Lead with in-airport options that suit any connection length
- Then what becomes possible with a longer connection, saying roughly how many hours each option needs (including immigration and transit time)
- Exact transit options (train, bus, taxi) with approximate costs and travel times
- How long before departure they should be back at the airport (accounting for security lines and immigration)

Tell them to check the connection time on their booking before leaving the airport. Be concise and practical.
${visaRule}`
  }

  const duration = formatLayoverDuration(durationMinutes)
  const isShort = durationMinutes < 180
  return `You are a travel expert helping a traveler with a ${duration} layover at ${airport} (IATA airport code).

Time of arrival (local): ${timeOfDay}
Visa status: ${visaStatus || "unknown"}

Provide practical, specific advice:
- What they can realistically do in ${duration.replace(/-/g, " ")} (including immigration and transit time)
- Specific places, attractions, or food near the airport or reachable in the time
- Exact transit options (train, bus, taxi) with approximate costs and travel times
- When they should head back to the airport (accounting for security lines and immigration)

Be concise and practical.${isShort ? " This layover is under 3 hours — focus on in-airport options only." : ""}
${visaRule}`
}
