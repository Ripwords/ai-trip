# AI Chat — Smart Scope Targeting, Intent Confirmation & Correctness Sweep

**Date:** 2026-07-15
**Status:** Approved (pending user review)
**Supersedes/extends:** `2026-05-20-ai-chat-rework-design.md` (the propose→apply "discuss" agent is now the de-facto chat path; the older `mode: plan/execute` split on `days/[dayId]/ai.post.ts` was never wired and stays quick-chip-only).

## Problem

The AI chat ("discuss" dock) is hard-wired to a single ambient **active day**. A three-way review surfaced two classes of problem:

1. **Scope is stuck on one day.** Propose tools bake in `ctx.dayId`; non-active days carry no ids in the injected context; the system prompt actively _forbids_ targeting another day or the whole trip ("ask the user to open that day"). Users asking "add coffee every morning" or "fix Day 4" get bounced with "open Day X first." This is the friction in the reference transcript.
2. **Confirmation & correctness gaps.** No visible undo (the `/restore` endpoint exists but is unwired), destructive removes look identical to adds and apply on one click, proposals don't clear/relabel on day-switch, a dead Cancel button, raw error strings surfaced to users, a credit charged before auth, a sanitizer bypass, and activities inserted with null coordinates while reporting success.

## Goals

1. Let the chat **smartly target scope** — a specific day, several days, or the whole trip — instead of only the open day, with server-side validation.
2. **Confirm user intention** — ask when scope is ambiguous, show each proposal's target, confirm destructive/bulk changes, and offer a visible Undo.
3. **Fix all correctness/security/UX bugs** the review found, in one combined plan.

## Non-goals (unchanged from prior spec)

- No chat history / persistence. Proposals and undo snapshots live in client state only.
- No new database tables. No schema migrations.
- No streaming responses. No cross-trip context.
- Quick chips (Fill gaps / Optimize / Generate full) keep their **instant-mutation** behavior (decision below) — they are not converted to propose→apply.

## Decisions (from brainstorming)

| Decision                 | Choice                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Packaging                | One combined implementation plan (bugs + feature).                                                               |
| Multi-day proposal model | **Per-day cards, grouped with an "Apply all"** header.                                                           |
| Confirmation behaviors   | All four: ask-when-ambiguous, scope badge, confirm destructive/bulk, visible Undo.                               |
| Apply-all orchestration  | **Client-side sequential**, best-effort, reusing the existing single-proposal apply endpoint. No batch endpoint. |
| Quick chips              | **Keep instant**, add snapshot + visible Undo. Not routed through propose→apply.                                 |

## Architecture overview

```
Client (app/pages/trips/[id].vue + AiDock.vue)
  activeDayId  ──────────────┐  (open day = default target, not the only target)
                             ▼
  POST /api/trips/[id]/discuss   { messages, dayId }
                             │
                             ▼
  discuss.post.ts
   • auth + access + validate  ── THEN consume credit (bug B1)
   • detectInjection() over ALL messages; normalize user messages (bug B3)
   • buildTripContext(): inject EVERY day's [day:uuid] + activities' [act:uuid]
   • createDiscussTools(ctx{ tripId, activeDayId, days[], ... }, collector)
                             │
                             ▼
  discussAgent.generate(maxSteps ~10)
   • propose*(dayId?/dayIds?) → resolveTargetDay(ctx, dayId) → validated day(s)
   • ambiguous scope → ask a clarifying question (prose, no proposals)
   • same change across days → dayIds[] expands to N per-day proposals
                             │  returns { message, proposals: Proposal[] }
                             ▼
  AiDock renders proposals, grouped by request:
   • scope badge per card ("Day 3")   • grouped header "Applies to N days" + [Apply all]
   • destructive styling for remove    • Apply / Dismiss / Undo
                             │
        Apply (per card or Apply-all sequential, best-effort)
                             │  snapshot each target day BEFORE mutating
                             ▼
  POST /api/trips/[id]/proposals/apply   { proposal }
   • applyProposal(): guards extended (B4 null-coords, B5 txn, B6 zero-change)
                             │
                    Undo → POST /api/trips/[id]/days/[dayId]/restore { activities: snapshot }
```

---

## Feature 1 — Smart scope targeting

### 1.1 Trip context injection (`discuss.post.ts` `buildTripContext`)

Today `buildTripContext` renders the focus day's activities with `[uuid]` ids and **all other days by name only** (`discuss.post.ts:79-90`) — the structural blocker. `getTripWithRelations` already loads every day in full, so:

- Emit **every** day with a stable id and its date/accommodation:
  `--- Day 3 (2026-07-17) [day:1a2b…] · staying at Four Seasons ---`
- Emit **each** day's activities with bracketed ids (compact, one line each):
  `  • [act:9f8e…] 09:00 Marble Mountains — attraction (90min)`
- Continue to mark which day is **open** (the default target): a `· OPEN` tag on that day's header.
- Keep it compact (name + type + time + id). For a 14-day trip this is ~100 lines — acceptable; if a trip exceeds a threshold (e.g. >20 days) fall back to full detail for the open day + adjacent days and id-only headers for the rest. (Threshold behavior is a guard, not the common path.)

### 1.2 Tool schema + `resolveTargetDay`

`TripToolsContext` (`ai-tools.ts:46-51`) gains `activeDayId: string` (renamed from `dayId` for clarity) and `days: { id: string; dayNumber: number }[]` (passed from `discuss.post.ts`, already loaded).

New helper in `ai-tools.ts`:

```ts
function resolveTargetDay(
  ctx,
  dayId?: string,
): { ok: true; dayId: string } | { ok: false; error: string } {
  const target = dayId ?? ctx.activeDayId
  if (!target)
    return { ok: false, error: "No day in scope. Ask the user which day (or 'all days')." }
  if (!ctx.days.some((d) => d.id === target)) {
    return { ok: false, error: `Unknown dayId ${target}. Use a [day:…] id from the trip context.` }
  }
  return { ok: true, dayId: target }
}
```

This **replaces `requireActiveDay`** and closes **bug B2** (add/set-accommodation previously had no server-side day guard). It validates the model-chosen day belongs to the trip — the same defense-in-depth as `validateActivityIds`, which now receives the resolved target day.

Each `propose*` tool input schema gains an optional `dayId: z.string().uuid().optional()`. `validateActivityIds(resolvedDayId, ids)` is called with the resolved target for remove/reschedule/reorder.

### 1.3 Multi-day "same change" — `dayIds` expansion

To keep per-day cards **and** stay under the step budget for "add X to every morning" / "push dinner 30 min later every day", `proposeAddActivities` and `proposeReschedule` accept an optional `dayIds: z.array(z.string().uuid()).min(1).optional()` (mutually exclusive with `dayId`). When present, the tool resolves/validates each day and **pushes one proposal per day** into the collector (same payload, per-day `dayId`). One tool call → N per-day cards.

- For reschedule, `dayIds` requires `activityIds` that exist on **each** target day; if an id is missing on a day, that day is skipped and the tool returns which days matched (the agent reports honestly). Realistically the agent uses `dayIds` for adds (same venue/time slot) and single `dayId` for reschedules; both are supported.

### 1.4 System prompt rewrite (`discuss-agent.ts`)

- Remove: "propose\* tools operate on the ACTIVE day automatically… you do NOT pass a day id" and "If you don't see a bracketed id… ask the user to open that day" (`:28-30`) and "Don't propose whole-day reschedules or route optimizations from chat" (`:35`).
- Add: every day's `[day:…]` id and its activities' `[act:…]` ids are now in context; target any day by passing its `dayId`, or several via `dayIds`; the **open day is the default** when the user doesn't name one.
- Add the **ambiguity rule** (Feature 2.1): when a request could mean one day or many and the user didn't say, ask a one-line clarifying question and emit **no** proposals that turn.

### 1.5 Step budget

`discuss.post.ts` `maxSteps: 6` → `10` to accommodate multi-day planning loops (per-day `searchPlaces` + propose). Revisit if traces show truncation; `dayIds` batching keeps the common cases cheap.

---

## Feature 2 — Confirmation & intent

### 2.1 Ask-when-ambiguous

Prompt behavior only (2.4 above). The agent already can return prose with an empty `proposals[]`. No schema change.

### 2.2 Scope badge + grouped cards + Apply-all

Proposals returned in one turn are grouped **client-side** by a shared `groupId`. To group without a schema change, the discuss response groups proposals that share the agent's summarizing turn: add an optional `groupId?: string` and `groupLabel?: string` to the `Proposal` type (client-render metadata only; ignored by `applyProposal`). The agent doesn't set these — `discuss.post.ts` assigns a single `groupId` to all proposals produced in one response and a `groupLabel` derived from the assistant summary. (Simplest correct grouping: all proposals from one turn = one group. A single-day turn renders as today.)

`AiDock.vue`:

- Each card shows a **scope badge** from `proposal.dayId` → "Day N" (looked up in loaded trip data).
- When a group has ≥2 proposals, render a group header — "Applies to N days" — with **Apply all** and **Dismiss all**.
- Per-card **Apply / Dismiss** unchanged.

### 2.3 Confirm destructive / bulk

Reuse `useConfirm({ destructive: true })`:

- Before applying any `remove-activities` proposal.
- Before an **Apply all** whose group spans ≥3 days or contains any removal.
  Copy example: "Remove 3 stops from Day 2? You can undo this." Single additive applies do not confirm (avoid nagging).

### 2.4 Visible Undo (wire the dormant `/restore`)

- **Snapshot before mutate:** before applying a proposal to day X (or each day in Apply-all), capture that day's current activities from loaded trip data into a `Map<dayId, ActivitySnapshot[]>` matching `restore.post.ts`'s `activitySnapshotSchema`.
- **Surface Undo:** the applied card flips to "Applied · Undo"; **also** show a toast with an Undo action.
- **`useToast` extension:** add an optional `action?: { label: string; onClick: () => void }` to `notify`; `ToastHost.vue` renders it as a button. Backwards compatible (optional).
- **Undo:** POST the snapshot to `/api/trips/[id]/days/[dayId]/restore`, then `refresh()`. Per-day (matches the endpoint and the per-day card model).
- **Quick chips** (Optimize/Fill): snapshot the open day before the instant mutation and surface the same Undo toast. Chips stay instant (decision).

---

## Feature 3 — Apply-all orchestration (client-side sequential)

`handleApplyGroup(group)`:

1. If confirm needed (2.3), confirm once for the group.
2. For each proposal in order: snapshot its day → set card `applying` → POST `/proposals/apply` → set `applied`/`error`. Continue on failure (best-effort).
3. After the loop, one `refresh()`. Show a summary toast: "Applied 3 of 4 · 1 couldn't be located" when partial, with Undo covering the days that changed.

No new endpoint, no cross-day transaction. Undo is per-day (a per-day snapshot map), so a group Undo restores each changed day.

---

## Bug-fix sweep (folded in)

### Backend

- **B1 — credit before auth/validate** (`discuss.post.ts:122`). Move `tryConsumeAiCredit` to **after** `readValidatedBody` and `requireTripAccess`, or wrap the handler so any pre-completion throw refunds. Removes the viewer/malformed-request credit burn. Remove the now-redundant 404 refund path.
- **B2 — no day guard on add/accommodation.** Resolved by `resolveTargetDay` (Feature 1.2).
- **B3 — sanitizer bypass via client `assistant` messages** (`discuss.post.ts:135`). Extract `detectInjection(text): boolean` from `sanitize.ts` (the pattern + base64 checks, no whitespace-collapsing transform). Run `detectInjection` over **every** message regardless of role and reject the request on a hit; keep full `sanitizePromptInput` normalization for **user** messages only (preserves assistant markdown). Add a test proving assistant markdown is not mangled and a fabricated-assistant injection is rejected.
- **B4 — null-coordinate activities inserted & reported as success** (`proposals.ts:230-301`, `enrich.ts` fast path). In the add-activities apply branch, **drop** activities whose `lat/lng` are null after enrichment; count them; surface a partial result ("Added 2 · couldn't locate 1: <name>") instead of silent "Applied." Honors the "always validate via Maps" invariant.
- **B5 — non-transactional reschedule** (`proposals.ts:212-228`). Wrap the N updates in a single `db.transaction` (dev) / `db.batch` (prod), mirroring `restore.post.ts:73-89`.
- **B6 — zero-change "Applied"** on optimize/set-accommodation (`proposals.ts:399,403-416`). Extend the 0-change guard (`:421-431`) so these return an explicit "no change" the UI can render rather than a false "Applied."
- **B7 / B8 (low, hardening)** — `apply.post.ts` already re-validates that `proposal.dayId` belongs to the route trip and checks access, so there is no tenancy hole; the `proposal.dayId !== ctx.dayId` guard in `applyProposal` (`proposals.ts:185`) is currently a no-op for the sole production caller. Keep it as defense-in-depth (it protects future callers). Separately, delimit/escape stored free-text (activity names, accommodation) when injected into the prompt context (`buildTripContext`) so a collaborator-authored name can't act as an instruction.

### Frontend

- **F1 (High) — dead Cancel + can't close mid-request.** Wire `@cancel` on `<AiDock>`; pass an `AbortController` signal to the discuss/quick `$fetch`; allow `collapse()` while loading (abort in-flight, keep the thread).
- **F2 (High) — wrong-day apply / stale proposals.** Largely resolved by scope badges (2.2): a card always carries and displays its own `dayId` and applies there regardless of the open day. Additionally clear proposals on **trip** switch and mark stale ones (409) as "no longer applicable" instead of a raw error.
- **F3 — no undo on chips.** Resolved by 2.4.
- **F4 — destructive removes indistinct** (`AiDock.vue:213`). Red/destructive tone + the 2.3 confirm.
- **F5 — ghost card on dismiss** (`AiDock.vue:358-363`). Move the dismissed condition to the `<li>` (`v-if`) so the whole item unmounts.
- **F6 — raw ofetch error strings** (`[id].vue:787,825`). Map to friendly copy; the discuss endpoint already returns graceful text on agent error.
- **F7 — starters promise trip-wide** (`useDiscussionStarters.ts`). Now valid (the tools can do it); keep, and add a small dock scope hint ("Editing your trip · Day 3 open").
- **F8 — dead composable** (`useAiPromptSuggestions.ts`). Delete.
- **F9 — a11y** (`AiDock.vue:99-103`). Esc-to-close, restore focus to the FAB on close, `role="dialog"`/`aria-modal` + focus trap on the mobile sheet — reuse `useModalA11y`.

---

## Data model / types

- `Proposal` (`proposals.ts`) gains **client-only** optional metadata: `groupId?: string`, `groupLabel?: string`. `proposalSchema` accepts them; `applyProposal` ignores them. No new proposal kinds; per-proposal `dayId` already models multi-day.
- No new DB tables. Undo snapshots are a client-side `Map<dayId, ActivitySnapshot[]>` shaped to `restore.post.ts`'s `activitySnapshotSchema`.
- `TripToolsContext`: `dayId` → `activeDayId`; add `days: { id: string; dayNumber: number }[]`. Note the rename touches the other consumers of `ctx.dayId` too — `readDay` (`ai-tools.ts:123`) and `runReview` (`:174`) read it as the day-in-scope; both switch to `ctx.activeDayId`.

## Error handling

- Plan/discuss failures: refund credit (B1) and return the existing graceful message.
- Apply failures: friendly copy (F6); stale-proposal 409 marks the card "no longer applicable" (F2).
- Apply-all: best-effort; partial summary toast; Undo covers only changed days.
- Enrichment miss: activity dropped + reported (B4), never silently inserted with null coords.
- Tool failures inside the agent loop already return `{ error }` rather than throwing — unchanged.

## Testing (TDD — red first, per project convention)

Server (`node --import tsx --test`, shim Nitro auto-imports as in `enrich.test.ts`):

- `resolveTargetDay`: uses provided day, validates trip membership, rejects other-trip/unknown day, falls back to active day, errors when neither.
- `dayIds` expansion → N proposals with correct per-day `dayId`.
- B4: add branch drops null-coord activities and reports the count.
- B5: reschedule is atomic (one txn/batch).
- B6: optimize/set-accommodation with no change do not report "Applied."
- B1: credit refunded when access/validation throws; not consumed before auth.
- B3: `detectInjection` catches fabricated-assistant injection; user-message normalization unchanged; assistant markdown preserved.
- Grouping: `discuss.post.ts` assigns one `groupId` per turn.

Client: component tests are not established in this repo; cover client orchestration (snapshot capture, Apply-all sequencing, Undo POST shape) with a small extracted pure module (`useProposalApply` orchestration helpers) unit-tested, plus manual verification via the `verify`/`run` skill against the live app.

## Risks & mitigations

- **Step-budget truncation** on broad multi-day requests → `dayIds` batching + `maxSteps` 10; revisit from traces.
- **Context token growth** (all-day ids every turn) → compact one-line format + >20-day fallback.
- **Apply-all partial failure** → best-effort with explicit partial summary + per-day Undo; no false "all applied."
- **Undo scope** → per-day only (matches `/restore`); a group Undo loops per changed day.
- **Prompt-injection** via stored data → `detectInjection` on all messages + delimiting injected free-text; blast radius still bounded (read-only tools; proposals require explicit apply on the user's own trip).

## File summary

**New**

- Tests: `server/lib/ai-tools.test.ts` additions (or new `resolve-target-day.test.ts`), `proposals.test.ts` additions, `sanitize.test.ts`, `discuss.post` grouping test.

**Modified — server**

- `server/api/trips/[id]/discuss.post.ts` — credit ordering (B1), `detectInjection` over all messages (B3), all-day context injection (F1.1), pass `days`/`activeDayId` + assign `groupId` (2.2), `maxSteps` 10.
- `server/lib/ai-tools.ts` — `resolveTargetDay`, optional `dayId`/`dayIds` on propose tools, ctx `days`/`activeDayId`.
- `server/lib/discuss-agent.ts` — system-prompt rewrite (scope + ambiguity).
- `server/lib/proposals.ts` — `groupId`/`groupLabel` on schema, B4/B5/B6 apply guards.
- `server/utils/sanitize.ts` — export `detectInjection`.

**Modified — client**

- `app/pages/trips/[id].vue` — snapshot/undo wiring, Apply-all orchestration, Cancel/AbortController (F1), clear-on-trip-switch (F2), friendly errors (F6).
- `app/components/AiDock.vue` — scope badges, grouped header + Apply-all/Dismiss-all, destructive styling + confirm (F4), ghost-card fix (F5), Cancel wiring (F1), a11y (F9), scope hint (F7).
- `app/composables/useToast.ts` + `app/components/ToastHost.vue` — optional action button (2.4).
- Delete `app/composables/useAiPromptSuggestions.ts` (F8).

**Unchanged**

- `server/api/trips/[id]/days/[dayId]/restore.post.ts` (now consumed by the client), `review.post.ts`, all schema/migration files, `days/[dayId]/ai.post.ts` quick-chip behavior (instant, decision).
