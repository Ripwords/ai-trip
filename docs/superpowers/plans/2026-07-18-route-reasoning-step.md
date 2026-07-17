# Route-Reasoning Step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated route-reasoning step to every itinerary-shaping LLM prompt so generated days never backtrack geographically, enforced in generation by a required first-position `routeReasoning` schema field.

**Architecture:** Pure prompt + zod-schema changes in three server files (`server/lib/ai.ts`, `server/lib/trip-outline.ts`, `server/lib/discuss-agent.ts`). The four day-level generation schemas plus the outline schema gain a required `routeReasoning: z.string()` as their FIRST property (zod preserves key order into the JSON schema, so the model writes the route walk-through before the activities). The field is logged and discarded — no API-response, DB, or frontend changes.

**Tech Stack:** TypeScript, zod v4, AI SDK `generateObject`, bun test runner with `node:test` imports.

**Spec:** `docs/superpowers/specs/2026-07-18-route-reasoning-step-design.md`

## Global Constraints

- Never use `any`; never re-define API return types in the frontend (no frontend changes here anyway).
- Conventional Commits (`feat:`, `test:`, `docs:`).
- Tests: colocated `server/lib/<name>.test.ts`, `import assert from "node:assert/strict"` + `import { describe, it } from "node:test"`, run with `bun test <file>`.
- A pre-commit hook auto-runs `oxlint --fix && oxfmt --write .` — if it reformats, the commit still lands; don't fight it.
- `routeReasoning` must be the FIRST key of every schema it's added to, and must never appear in any handler's return value, `TripOutline`, or persisted activity.
- All work happens in the worktree at `.claude/worktrees/llm-route-reasoning-step` (branch `worktree-llm-route-reasoning-step`).

---

### Task 1: ROUTE LOGIC block in SCHEDULE_RULES

**Files:**

- Modify: `server/lib/ai.ts:86` (the `SCHEDULE_RULES` const — export it, add block)
- Test: `server/lib/ai.test.ts` (new file)

**Interfaces:**

- Consumes: nothing.
- Produces: `export const SCHEDULE_RULES: string` from `server/lib/ai.ts`, now containing a `ROUTE LOGIC` section. Tasks 2's test file appends to `server/lib/ai.test.ts` created here.

- [ ] **Step 1: Write the failing test**

Create `server/lib/ai.test.ts`:

```typescript
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { SCHEDULE_RULES } from "./ai"

describe("SCHEDULE_RULES", () => {
  it("contains a dedicated ROUTE LOGIC step that runs before times/order are chosen", () => {
    assert.match(SCHEDULE_RULES, /ROUTE LOGIC/)
    assert.match(SCHEDULE_RULES, /BEFORE picking times or order/i)
  })

  it("anchors the day on explicit start and end points", () => {
    assert.match(SCHEDULE_RULES, /anchors/i)
  })

  it("demands one continuous path with no doubling back", () => {
    assert.match(SCHEDULE_RULES, /continuous path/i)
    assert.match(SCHEDULE_RULES, /double back/i)
  })

  it("puts en-route stops on the day that actually travels that leg", () => {
    assert.match(SCHEDULE_RULES, /on the way between/i)
    assert.match(SCHEDULE_RULES, /round trip/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/lib/ai.test.ts`
Expected: FAIL — `SCHEDULE_RULES` is not exported (`SyntaxError`/`export not found` or undefined import).

- [ ] **Step 3: Implement**

In `server/lib/ai.ts`, change `const SCHEDULE_RULES = ...` (line ~86) to `export const SCHEDULE_RULES = ...`, and insert the ROUTE LOGIC block between the `DURATION RULE (hard):` section and the `DEFAULT DAY BLUEPRINT` section (i.e. after the line ending `— leave it out of the duration.` and before `DEFAULT DAY BLUEPRINT`):

```
ROUTE LOGIC (dedicated step — walk this through BEFORE picking times or order):
1. Identify the day's anchors: where the traveler starts (arrival airport, accommodation, start location) and where the day ends (accommodation, departure point).
2. Plan the stops as ONE continuous path from start anchor to end anchor, moving in a consistent direction. Never route past a place only to double back to it later in the day.
3. Cluster geographically nearby stops next to each other in the sequence.
4. A stop that lies on the way between two anchors (a sight between the airport and the hotel, or between two cities) belongs on the day the traveler actually travels that leg — never on a day that turns it into a dedicated round trip.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test server/lib/ai.test.ts`
Expected: 4 pass. Also run `bun test server/lib/trip-outline.test.ts` (it imports `./ai`) — all pass.

- [ ] **Step 5: Commit**

```bash
git add server/lib/ai.ts server/lib/ai.test.ts
git commit -m "feat(ai): add dedicated ROUTE LOGIC step to SCHEDULE_RULES"
```

---

### Task 2: routeReasoning field, first in the four generation schemas

**Files:**

- Modify: `server/lib/ai.ts` (schemas section ~line 16-45; handlers `handleAdd` ~line 336, `handleFillGaps` ~line 447, `handleOptimize` ~line 508, `handleReschedule` ~line 553)
- Test: `server/lib/ai.test.ts` (append)

**Interfaces:**

- Consumes: `aiActivitySchema` (existing, unexported — stays unexported), `SCHEDULE_RULES` export from Task 1.
- Produces: `export const addResultSchema`, `export const fillGapsResultSchema`, `export const optimizeResultSchema`, `export const rescheduleResultSchema` from `server/lib/ai.ts` — each a `z.object` whose first key is `routeReasoning: z.string()`. Handler return types are UNCHANGED (`routeReasoning` is logged, never returned).

- [ ] **Step 1: Write the failing tests**

Append to `server/lib/ai.test.ts` (extend the existing import from `./ai`):

```typescript
import {
  SCHEDULE_RULES,
  addResultSchema,
  fillGapsResultSchema,
  optimizeResultSchema,
  rescheduleResultSchema,
} from "./ai"

describe("generation schemas", () => {
  it("addResultSchema requires routeReasoning as its first property", () => {
    assert.equal(Object.keys(addResultSchema.shape)[0], "routeReasoning")
    assert.equal(addResultSchema.shape.routeReasoning.safeParse(undefined).success, false)
  })

  it("fillGapsResultSchema requires routeReasoning as its first property", () => {
    assert.equal(Object.keys(fillGapsResultSchema.shape)[0], "routeReasoning")
    assert.equal(fillGapsResultSchema.shape.routeReasoning.safeParse(undefined).success, false)
  })

  it("optimizeResultSchema requires routeReasoning as its first property", () => {
    assert.equal(Object.keys(optimizeResultSchema.shape)[0], "routeReasoning")
    assert.equal(optimizeResultSchema.shape.routeReasoning.safeParse(undefined).success, false)
  })

  it("rescheduleResultSchema requires routeReasoning as its first property", () => {
    assert.equal(Object.keys(rescheduleResultSchema.shape)[0], "routeReasoning")
    assert.equal(rescheduleResultSchema.shape.routeReasoning.safeParse(undefined).success, false)
  })

  it("activity objects never carry routeReasoning (no leak into persisted activities)", () => {
    const activityShape = addResultSchema.shape.activities.element.shape
    assert.ok(!("routeReasoning" in activityShape))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test server/lib/ai.test.ts`
Expected: FAIL — the four schema exports don't exist yet.

- [ ] **Step 3: Implement the schemas**

In `server/lib/ai.ts`, directly after `export type AIActivity = z.infer<typeof aiActivitySchema>` (line ~45), add:

```typescript
// Dedicated route-reasoning step (see docs/superpowers/specs/2026-07-18-route-reasoning-step-design.md):
// FIRST property of every day-shaping schema so the model walks the route before
// writing activities. Logged for debugging, never returned or persisted.
const routeReasoningField = z
  .string()
  .describe(
    "Dedicated route check — walk the day's route stop-by-stop from its start anchor to its end anchor. Name each stop in visiting order and confirm the path never doubles back past a place already visited; if it does, fix the order before writing the final answer.",
  )

export const addResultSchema = z.object({
  routeReasoning: routeReasoningField,
  activities: z.array(aiActivitySchema),
})

export const fillGapsResultSchema = z.object({
  routeReasoning: routeReasoningField,
  activities: z.array(aiActivitySchema),
  timeUpdates: z.array(
    z.object({
      name: z.string(),
      suggestedTime: z.string(),
      estimatedDurationMinutes: z.number().int().positive(),
    }),
  ),
})

export const optimizeResultSchema = z.object({
  routeReasoning: routeReasoningField,
  orderedActivities: z.array(z.object({ name: z.string(), suggestedTime: z.string() })),
})

export const rescheduleResultSchema = z.object({
  routeReasoning: routeReasoningField,
  timeUpdates: z.array(
    z.object({
      name: z.string().describe("Exact activity name"),
      suggestedTime: z.string().describe("New start time in HH:MM"),
      estimatedDurationMinutes: z.number().int().positive(),
    }),
  ),
})
```

Then swap each handler's inline schema for the export and log the reasoning:

- `handleAdd` (~line 340): replace `schema: z.object({ activities: z.array(aiActivitySchema) }),` with `schema: addResultSchema,`. After the `generateObject` call resolves (right before `const activities = object.activities ?? []`), add:
  `logger.info("[add] route reasoning", { routeReasoning: object.routeReasoning })`
- `handleFillGaps` (~line 451): replace the inline `schema: z.object({ activities: ..., timeUpdates: ... })` with `schema: fillGapsResultSchema,`. Before `const activities = object.activities ?? []`, add:
  `logger.info("[fill] route reasoning", { routeReasoning: object.routeReasoning })`
- `handleOptimize` (~line 512): replace the inline `schema: z.object({ orderedActivities: ... })` with `schema: optimizeResultSchema,`. Before the `logger.info("[optimize] Done", ...)` line, add:
  `logger.info("[optimize] route reasoning", { routeReasoning: object.routeReasoning })`
- `handleReschedule` (~line 557): replace the inline `schema: z.object({ timeUpdates: ... })` with `schema: rescheduleResultSchema,`. Before the `logger.info("[reschedule] Done", ...)` line, add:
  `logger.info("[reschedule] route reasoning", { routeReasoning: object.routeReasoning })`

Return statements are untouched — `routeReasoning` is never returned.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test server/lib/ai.test.ts`
Expected: 9 pass (4 from Task 1 + 5 new). Then `bun test` (full suite) — no new failures (the `flight-import.test.ts` 5s timeout is a pre-existing failure on master; ignore it).

- [ ] **Step 5: Commit**

```bash
git add server/lib/ai.ts server/lib/ai.test.ts
git commit -m "feat(ai): require first-position routeReasoning in day generation schemas"
```

---

### Task 3: Inter-day route guidance + routeReasoning in the trip outline

**Files:**

- Modify: `server/lib/trip-outline.ts` (schema ~line 49, `buildPrompt` Rules ~line 143-150, logging after `raw` in `buildTripOutline` ~line 187)
- Test: `server/lib/trip-outline.test.ts` (append tests; extend `rawOutline` fixture)

**Interfaces:**

- Consumes: existing `buildTripOutline(input, deps)` with `deps.generate` injection, existing `rawOutline()` fixture and `input` fixture in the test file.
- Produces: `export const outlineSchema` from `server/lib/trip-outline.ts` with first key `routeReasoning: z.string()`; `TripOutlineRaw` (inferred) therefore gains `routeReasoning: string`. `TripOutline`/`TripOutlineDay` (the returned types) are UNCHANGED.

- [ ] **Step 1: Write the failing tests**

In `server/lib/trip-outline.test.ts`, add `outlineSchema` to the existing import from `./trip-outline`, then append inside the file's top-level `describe` (or as a new `describe` block at the end):

```typescript
describe("route reasoning", () => {
  it("outline schema requires routeReasoning as its first property", () => {
    assert.equal(Object.keys(outlineSchema.shape)[0], "routeReasoning")
    assert.equal(outlineSchema.shape.routeReasoning.safeParse(undefined).success, false)
  })

  it("outline prompt sequences areas as an arc and places en-route sights on transfer days", async () => {
    let seenPrompt = ""
    await buildTripOutline(input, {
      generate: async (args) => {
        seenPrompt = args.prompt
        return rawOutline()
      },
    })
    assert.match(seenPrompt, /double back/i)
    assert.match(seenPrompt, /en-route|on the way/i)
  })

  it("routeReasoning never leaks into the returned outline", async () => {
    const outline = await buildTripOutline(input, { generate: async () => rawOutline() })
    assert.ok(!("routeReasoning" in outline))
    for (const day of outline.days) {
      assert.ok(!("routeReasoning" in day))
    }
  })
})
```

Also extend the `rawOutline` fixture (required by the new `TripOutlineRaw` type — do it now so only the schema change is left to make tests compile): add as the first property of the returned object:

```typescript
routeReasoning: "Day 1 lands late so it stays near Gion; day 3 arcs through Higashiyama without doubling back.",
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test server/lib/trip-outline.test.ts`
Expected: FAIL — `outlineSchema` is not exported, and the fixture's `routeReasoning` key doesn't exist on `TripOutlineRaw`.

- [ ] **Step 3: Implement**

In `server/lib/trip-outline.ts`:

1. Export the schema and add the field first:

```typescript
export const outlineSchema = z.object({
  routeReasoning: z
    .string()
    .describe(
      "Dedicated route check — the trip's geographic arc across days: which area each day covers and why that order never makes the traveler double back. Place en-route sights on the day that travels past them.",
    ),
  days: z.array(
    z.object({
      dayNumber: z.number().int().describe("The day number this entry plans"),
      theme: z.string().describe("Short theme, e.g. 'Old-town temples & street food'"),
      focusArea: z.string().describe("Neighborhood/area to concentrate the day in"),
      mustInclude: z
        .array(z.string())
        .describe("0-3 anchor places for this day, drawn from saved ideas where they fit"),
      guidance: z.string().describe("One line of pacing/meal/timing guidance for this day"),
    }),
  ),
  avoidRepeats: z.array(z.string()).describe("Venue names no day should duplicate"),
})
```

(The `days` and `avoidRepeats` members are byte-identical to the current file — only `export` and the new first `routeReasoning` key change.)

2. In `buildPrompt`, append two rules to the `Rules:` list (after the final `- Plan themes and areas only ...` line):

```
- Sequence the days' focus areas as ONE geographic arc across the trip — never make the traveler double back to an area they already covered on an earlier day.
- Put en-route sights on the day the traveler actually travels past them (a stop between two cities belongs on the transfer day, not on a day that turns it into a dedicated round trip).
```

3. In `buildTripOutline`, right after `const raw = await withOneRetry(...)` (line ~187), add:

```typescript
console.info(`[trip-outline] route reasoning: ${raw.routeReasoning}`)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test server/lib/trip-outline.test.ts`
Expected: all pass (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add server/lib/trip-outline.ts server/lib/trip-outline.test.ts
git commit -m "feat(ai): add inter-day route guidance and routeReasoning to trip outline"
```

---

### Task 4: ROUTE CHECK step in the discuss prompt

**Files:**

- Modify: `server/lib/discuss-agent.ts` (insert block into `DISCUSS_SYSTEM_PROMPT`, after the `CRITICAL — scope.` paragraph ~line 33, before the `When scope is AMBIGUOUS` paragraph ~line 35)
- Test: `server/lib/discuss-agent.test.ts` (append)

**Interfaces:**

- Consumes: `DISCUSS_SYSTEM_PROMPT` export (existing).
- Produces: nothing new — prompt content only.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("discussAgent", ...)` block in `server/lib/discuss-agent.test.ts`:

```typescript
it("system prompt has a dedicated route check before proposing changes", () => {
  assert.match(DISCUSS_SYSTEM_PROMPT, /ROUTE CHECK/)
  assert.match(DISCUSS_SYSTEM_PROMPT, /before any propose\* call/i)
  assert.match(DISCUSS_SYSTEM_PROMPT, /double back/i)
})

it("route check pushes back when the user's own request would backtrack", () => {
  assert.match(DISCUSS_SYSTEM_PROMPT, /user's own request would create the backtracking/i)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test server/lib/discuss-agent.test.ts`
Expected: the 2 new tests FAIL; the rest pass.

- [ ] **Step 3: Implement**

In `server/lib/discuss-agent.ts`, insert this paragraph into `DISCUSS_SYSTEM_PROMPT` as its own block, after the `CRITICAL — scope.` paragraph and before the `When scope is AMBIGUOUS` paragraph:

```
ROUTE CHECK — dedicated step before any propose* call that adds, moves, or reorders activities: walk the affected day's route from its start anchor (accommodation or arrival point) through each stop in order to where the day ends, using the locations already in the trip context. Confirm your change doesn't make the traveler double back past somewhere they already were. If it would — including when the user's own request would create the backtracking — say so and propose the better ordering instead of silently going along. Use getDistance only when you're genuinely unsure of relative positions; don't spend steps confirming geography you already know.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test server/lib/discuss-agent.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add server/lib/discuss-agent.ts server/lib/discuss-agent.test.ts
git commit -m "feat(ai): add dedicated ROUTE CHECK step to discuss prompt"
```

---

### Task 5: Full verification

**Files:** none new.

**Interfaces:** consumes everything above.

- [ ] **Step 1: Full test suite**

Run: `bun test`
Expected: same pass count as baseline + 14 new tests; the only failure is the pre-existing `flight-import.test.ts` commitImport 5s timeout (fails identically on master — not ours).

- [ ] **Step 2: Build**

Run: `bun run build`
Expected: `nuxt build` completes with no errors (typecheck alone misses Vue template compile errors — this project requires a real build before done).

- [ ] **Step 3: Lint check**

Run: `bunx oxlint server/lib/ai.ts server/lib/trip-outline.ts server/lib/discuss-agent.ts`
Expected: no NEW warnings on the touched files (pre-existing `no-underscore-dangle` warnings elsewhere are fine).

- [ ] **Step 4: Verify no behavioral leak paths**

Run: `grep -n "routeReasoning" server/lib/ai.ts server/lib/trip-outline.ts | grep -v "schema\|Field\|logger\|console\|describe\|//"`
Expected: no output — `routeReasoning` only appears in schema definitions, the shared field, and log lines; never in a return statement.

- [ ] **Step 5: Done**

No commit needed (verification only). Hand off via superpowers:finishing-a-development-branch.
