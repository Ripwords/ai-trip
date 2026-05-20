import type { Proposal } from "./proposal"

export interface ReviewFinding {
  id: string
  code: string
  severity: "critical" | "warning" | "suggestion"
  title: string
  message: string
  recommendation: string
  dayId: string
  dayNumber: number
  activityIds?: string[]
  proposal?: Proposal
}
