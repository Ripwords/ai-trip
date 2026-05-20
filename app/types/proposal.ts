// Mirror of server/lib/proposals.ts. Kept in sync manually — narrow types are fine for the UI.
export type Proposal =
  | { id: string; kind: "add-activities"; dayId: string; summary: string;
      payload: { activities: unknown[] } }
  | { id: string; kind: "remove-activities"; dayId: string; summary: string;
      payload: { activityIds: string[] } }
  | { id: string; kind: "reschedule"; dayId: string; summary: string;
      payload: { updates: { activityId: string; suggestedTime: string; estimatedDurationMinutes: number }[] } }
  | { id: string; kind: "optimize-route"; dayId: string; summary: string;
      payload: { orderedActivityIds?: string[] } }
  | { id: string; kind: "set-accommodation"; dayId: string; summary: string;
      payload: { name: string; address: string | null; lat: number | null; lng: number | null; placeId: string | null } }
