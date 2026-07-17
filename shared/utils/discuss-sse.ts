/**
 * The wire contract for the discuss endpoint's SSE stream
 * (`server/api/trips/[id]/discuss.post.ts` -> `app/pages/trips/[id].vue`).
 *
 * Lives in shared/ — Nuxt's built-in cross-side location (see
 * shared/utils/currency.ts for the existing convention) — rather than in
 * server/lib/discuss-stream.ts, so the client imports it via the `#shared`
 * alias instead of reaching directly into server/. That import used to cross
 * a boundary Nuxt's generated tsconfig nominally excludes (app/ -> server/);
 * it only typechecked because no tsconfig project here sets `composite: true`,
 * so the exclusion was never enforced as a hard project-reference boundary.
 * Both the endpoint (building each payload, via `toSseFrame` in
 * server/lib/discuss-stream.ts) and the client (narrowing each frame in
 * app/pages/trips/[id].vue) reference this union, so renaming a field breaks
 * the build on both sides instead of silently producing `undefined` at
 * runtime.
 *
 * Proposal shape: intentionally NOT `import type { Proposal } from
 * "../../server/lib/proposals"`. That was the first thing tried, since it's
 * the canonical, zod-inferred source of truth. But shared/ is included by
 * BOTH tsconfig.app.json and tsconfig.server.json (via `#shared`), so
 * pulling in server/lib/proposals.ts also pulls its whole transitive import
 * graph (db, drizzle-orm, google-maps, cost-guard, ...) into the app-side
 * typecheck program. Measured via `git stash` A/B with `bunx nuxi
 * typecheck`: baseline 28 pre-existing errors: with the cross-project
 * `import type` it became 37 — 9 new errors in files that don't reference
 * this module at all (AddActivityModal.vue "excessive stack depth", drizzle
 * `.returning()` inference in trips/activities/expenses/ideas POST routes,
 * etc.). That's the exact fragility this relocation exists to remove, just
 * moved one hop over, so it was rejected.
 *
 * Instead this file declares its own narrow `Proposal` shape — the same
 * trade the codebase already makes at app/types/proposal.ts ("Mirror of
 * server/lib/proposals.ts. Kept in sync manually — narrow types are fine for
 * the UI"). It only needs to be structurally close enough for two call
 * sites: the endpoint assigning the real `Proposal[]` into a `done` payload,
 * and the client reading `.id`/`.kind`/`.summary`/... off of it. Both are
 * structural (not nominal) checks, so this stays load-bearing for renames on
 * either of those two shapes without requiring nominal identity with the
 * canonical type. If server/lib/proposals.ts's shape changes incompatibly
 * (e.g. a required field added, or one of the shapes below renamed), the
 * `proposals: groupedProposals` assignment in discuss.post.ts fails to
 * typecheck — so drift is still caught at the one place it actually
 * matters (build time, server side), just not via nominal type identity.
 */
// The single UI-side mirror of server/lib/proposals.ts's Proposal. Narrow
// payloads are fine for the client; the server's real (wider) Proposal is
// assignable into these at the `done` push in discuss.post.ts, so a kind/field
// rename on the server still breaks that assignment at build time. app/types/
// proposal.ts re-exports this so there is exactly one mirror.
type ProposalBase = {
  id: string
  dayId: string
  summary: string
  groupId?: string
  groupLabel?: string
}
export type Proposal =
  | (ProposalBase & { kind: "add-activities"; payload: { activities: unknown[] } })
  | (ProposalBase & { kind: "remove-activities"; payload: { activityIds: string[] } })
  | (ProposalBase & {
      kind: "reschedule"
      payload: {
        updates: { activityId: string; suggestedTime: string; estimatedDurationMinutes: number }[]
      }
    })
  | (ProposalBase & { kind: "optimize-route"; payload: { orderedActivityIds?: string[] } })
  | (ProposalBase & { kind: "reorder-activities"; payload: { orderedActivityIds: string[] } })
  | (ProposalBase & {
      kind: "set-accommodation"
      payload: {
        name: string
        address: string | null
        lat: number | null
        lng: number | null
        placeId: string | null
      }
    })

export type DiscussSseEvent =
  | { event: "tool"; data: { line: string } }
  | { event: "text"; data: { delta: string } }
  | {
      event: "done"
      data: {
        message: string
        proposals: Proposal[]
        toolCallSummary: string[]
        creditsUsed: number
      }
    }
  | { event: "error"; data: { message: string } }
