/**
 * Receipt endpoints — issue #48.
 *
 * The interesting surface here is authorisation, not arithmetic: a receipt
 * carries card digits, an address and a name, so the tests below spend most of
 * their effort on the ways one could be read by the wrong person — a stranger,
 * a member of a different trip, a valid attachment id addressed through the
 * wrong expense — plus the ways a viewer might be allowed to write.
 *
 * `requireTripAccess` and `logTripAction` are the real implementations; the
 * fake below is only the database and the object store.
 *
 * The row lookups genuinely apply their `where`: the fake compiles each drizzle
 * condition with the real Postgres dialect and matches it against the stored
 * rows, so a handler that dropped `tripId` from its predicate fails here rather
 * than passing on a fake that ignores conditions.
 */

process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db"
// Exercise the storage abstraction through its second implementation: if the
// handlers had any knowledge of where the bytes live, this would not work.
process.env.RECEIPT_STORAGE_DRIVER = "memory"

import assert from "node:assert/strict"
import { afterAll, beforeEach, describe, it } from "bun:test"
import type { SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"

const { db } = await import("../db")
const { requireTripAccess, logTripAction } = await import("../utils/trip-access")
const { RECEIPT_MAX_BYTES, RECEIPT_MAX_PER_EXPENSE } = await import("./receipts")
const { memoryReceiptStorage } = await import("./receipt-storage")

const TRIP_ID = "11111111-1111-4111-8111-111111111111"
const OTHER_TRIP_ID = "22222222-2222-4222-8222-222222222222"
const EXPENSE_ID = "33333333-3333-4333-8333-333333333333"
const OTHER_EXPENSE_ID = "55555555-5555-4555-8555-555555555555"
const ATTACHMENT_ID = "66666666-6666-4666-8666-666666666666"
const OTHER_ATTACHMENT_ID = "77777777-7777-4777-8777-777777777777"
const OWNER_ID = "user-owner"
const EDITOR_ID = "user-editor"
const VIEWER_ID = "user-viewer"
const STRANGER_ID = "user-stranger"
/** Owns OTHER_TRIP_ID and nothing else. */
const OUTSIDER_ID = "user-outsider"

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const PDF_BYTES = new TextEncoder().encode("%PDF-1.7 body")

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface ExpenseRow {
  id: string
  tripId: string
}

interface AttachmentRow {
  id: string
  expenseId: string
  tripId: string
  storageKey: string
  fileName: string
  mimeType: string
  sizeBytes: number
  uploadedById: string | null
  createdAt: Date
}

interface TripRow {
  id: string
  userId: string
}

interface MemberRow {
  tripId: string
  userId: string
  role: "editor" | "viewer"
  status: "active" | "pending"
}

interface LogRow {
  tripId: string
  userId: string
  action: string
  description: string
  metadata?: Record<string, unknown>
}

interface Store {
  trips: TripRow[]
  expenses: ExpenseRow[]
  attachments: AttachmentRow[]
  log: LogRow[]
}

let store: Store
let request = { tripId: TRIP_ID, userId: OWNER_ID }

function makeAttachment(overrides: Partial<AttachmentRow> = {}): AttachmentRow {
  return {
    id: ATTACHMENT_ID,
    expenseId: EXPENSE_ID,
    tripId: TRIP_ID,
    storageKey: `receipts/${TRIP_ID}/${EXPENSE_ID}/seeded`,
    fileName: "receipt.png",
    mimeType: "image/png",
    sizeBytes: PNG_BYTES.byteLength,
    uploadedById: OWNER_ID,
    createdAt: new Date("2026-08-04T00:00:00Z"),
    ...overrides,
  }
}

function seed(overrides: Partial<Store> = {}): void {
  store = {
    trips: [
      { id: TRIP_ID, userId: OWNER_ID },
      { id: OTHER_TRIP_ID, userId: OUTSIDER_ID },
    ],
    expenses: [
      { id: EXPENSE_ID, tripId: TRIP_ID },
      { id: OTHER_EXPENSE_ID, tripId: OTHER_TRIP_ID },
    ],
    attachments: [],
    log: [],
    ...overrides,
  }
  // Every seeded attachment gets its bytes, so "the row exists but the object
  // does not" is a state a test has to create deliberately.
  memoryReceiptStorage.clear()
  for (const attachment of store.attachments) {
    void memoryReceiptStorage.put(attachment.storageKey, PNG_BYTES, attachment.mimeType)
  }
}

const members: MemberRow[] = [
  { tripId: TRIP_ID, userId: EDITOR_ID, role: "editor", status: "active" },
  { tripId: TRIP_ID, userId: VIEWER_ID, role: "viewer", status: "active" },
]

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

const dialect = new PgDialect()

const COLUMN_FIELDS: Record<string, string> = {
  id: "id",
  trip_id: "tripId",
  expense_id: "expenseId",
  storage_key: "storageKey",
}

/**
 * Evaluate the compiled `where` against a row. Only equality conjunctions are
 * needed here — anything else throws rather than silently matching, so a
 * handler that starts building a condition this cannot read fails loudly.
 */
function matchesSql(condition: SQL | undefined, row: Record<string, unknown>): boolean {
  if (!condition) return true
  const { sql, params } = dialect.sqlToQuery(condition)
  const clauses = sql.replace(/^\(|\)$/g, "").split(" and ")
  return clauses.every((clause) => {
    const match = /^"[a-z_]+"\."([a-z_]+)" = \$(\d+)$/.exec(clause.trim())
    if (!match) throw new Error(`unsupported clause: ${clause}`)
    const field = COLUMN_FIELDS[match[1] ?? ""]
    if (!field) throw new Error(`unknown column: ${match[1]}`)
    return row[field] === params[Number(match[2]) - 1]
  })
}

// ---------------------------------------------------------------------------
// Fake database + object store
// ---------------------------------------------------------------------------

interface Terminal<T> extends PromiseLike<T> {
  returning: () => Promise<T>
}

// oxlint-disable no-thenable
function terminal<T>(run: () => Promise<T>, defaultValue: T): Terminal<T> {
  return {
    then: (onFulfilled, onRejected) =>
      run()
        .then(() => defaultValue)
        .then(onFulfilled, onRejected),
    returning: () => run(),
  }
}
// oxlint-enable no-thenable

const original = {
  insert: db.insert,
  delete: db.delete,
  select: db.select,
  tripsFindFirst: db.query.trips.findFirst,
  membersFindFirst: db.query.tripMembers.findFirst,
  expensesFindFirst: db.query.expenses.findFirst,
  attachmentsFindFirst: db.query.expenseAttachments.findFirst,
  attachmentsFindMany: db.query.expenseAttachments.findMany,
}

function installFakeDb(): void {
  db.insert = ((table: unknown) => ({
    values: (values: Record<string, unknown>) =>
      terminal(async () => {
        // The activity log shares this method; only attachments are modelled.
        if (!("storageKey" in values)) {
          store.log.push(values as unknown as LogRow)
          return []
        }
        const row: AttachmentRow = {
          id: crypto.randomUUID(),
          expenseId: String(values.expenseId),
          tripId: String(values.tripId),
          storageKey: String(values.storageKey),
          fileName: String(values.fileName),
          mimeType: String(values.mimeType),
          sizeBytes: Number(values.sizeBytes),
          uploadedById: (values.uploadedById as string | null) ?? null,
          createdAt: new Date(),
        }
        store.attachments.push(row)
        return [{ ...row }]
      }, []),
  })) as unknown as typeof db.insert

  db.delete = ((table: unknown) => ({
    where: (condition?: SQL) =>
      terminal(async () => {
        const index = store.attachments.findIndex((a) => matchesSql(condition, a))
        if (index < 0) return []
        return store.attachments.splice(index, 1)
      }, []),
  })) as unknown as typeof db.delete

  db.select = (() => ({
    from: () => ({
      where: async (condition?: SQL) => [
        { total: store.attachments.filter((a) => matchesSql(condition, a)).length },
      ],
    }),
  })) as unknown as typeof db.select

  db.query.trips.findFirst = (async () =>
    store.trips.find((t) => t.id === request.tripId)) as unknown as typeof db.query.trips.findFirst

  db.query.tripMembers.findFirst = (async () =>
    members.find(
      (m) => m.tripId === request.tripId && m.userId === request.userId && m.status === "active",
    )) as unknown as typeof db.query.tripMembers.findFirst

  db.query.expenses.findFirst = (async (args?: { where?: SQL }) => {
    const row = store.expenses.find((e) => matchesSql(args?.where, e))
    return row ? { ...row } : undefined
  }) as unknown as typeof db.query.expenses.findFirst

  db.query.expenseAttachments.findFirst = (async (args?: { where?: SQL }) => {
    const row = store.attachments.find((a) => matchesSql(args?.where, a))
    return row ? { ...row } : undefined
  }) as unknown as typeof db.query.expenseAttachments.findFirst

  db.query.expenseAttachments.findMany = (async (args?: { where?: SQL }) =>
    store.attachments
      .filter((a) => matchesSql(args?.where, a))
      .map((a) => ({ ...a }))) as unknown as typeof db.query.expenseAttachments.findMany
}

function restoreDb(): void {
  db.insert = original.insert
  db.delete = original.delete
  db.select = original.select
  db.query.trips.findFirst = original.tripsFindFirst
  db.query.tripMembers.findFirst = original.membersFindFirst
  db.query.expenses.findFirst = original.expensesFindFirst
  db.query.expenseAttachments.findFirst = original.attachmentsFindFirst
  db.query.expenseAttachments.findMany = original.attachmentsFindMany
}

// ---------------------------------------------------------------------------
// Nitro globals
// ---------------------------------------------------------------------------

interface MultipartPart {
  name?: string
  filename?: string
  type?: string
  data: Uint8Array
}

interface FakeEvent {
  context: {
    params: Record<string, string>
    userId: string | null
    headers: Record<string, string>
    parts: MultipartPart[] | undefined
  }
  responseHeaders: Record<string, string>
}

interface NitroGlobals {
  defineEventHandler?: unknown
  getValidatedRouterParams?: unknown
  readMultipartFormData?: unknown
  getRequestHeader?: unknown
  setResponseHeaders?: unknown
  requireAuth?: unknown
  requireTripAccess?: unknown
  logTripAction?: unknown
}

const globals = globalThis as NitroGlobals

globals.defineEventHandler = (handler: unknown) => handler

globals.getValidatedRouterParams = async <T>(event: FakeEvent, validate: (input: unknown) => T) => {
  try {
    return validate(event.context.params)
  } catch (error) {
    throw createError({
      statusCode: 400,
      message: error instanceof Error ? error.message : "Bad Request",
    })
  }
}

globals.readMultipartFormData = async (event: FakeEvent) => event.context.parts
globals.getRequestHeader = (event: FakeEvent, name: string) =>
  event.context.headers[name.toLowerCase()]
globals.setResponseHeaders = (event: FakeEvent, headers: Record<string, string>) => {
  Object.assign(event.responseHeaders, headers)
}

globals.requireAuth = async (event: FakeEvent) => {
  const userId = event.context.userId
  if (!userId) throw createError({ statusCode: 401, message: "Unauthorized" })
  return { user: { id: userId } }
}

globals.requireTripAccess = requireTripAccess
globals.logTripAction = logTripAction

installFakeDb()

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

type Handler<T> = (event: FakeEvent) => Promise<T>

const base = "../api/trips/[id]/expenses/[expenseId]/attachments"

interface AttachmentSummary {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  uploadedById: string | null
  url: string
}

const uploadReceipt = (await import(`${base}/index.post`))
  .default as unknown as Handler<AttachmentSummary>
const listReceipts = (await import(`${base}/index.get`)).default as unknown as Handler<
  AttachmentSummary[]
>
const readReceipt = (await import(`${base}/[attachmentId].get`))
  .default as unknown as Handler<Buffer>
const deleteReceipt = (await import(`${base}/[attachmentId].delete`))
  .default as unknown as Handler<{ success: boolean }>

interface EventOptions {
  userId?: string | null
  tripId?: string
  expenseId?: string
  attachmentId?: string
  parts?: MultipartPart[]
  headers?: Record<string, string>
}

function filePart(overrides: Partial<MultipartPart> = {}): MultipartPart {
  return {
    name: "file",
    filename: "receipt.png",
    type: "image/png",
    data: PNG_BYTES,
    ...overrides,
  }
}

function makeEvent(options: EventOptions = {}): FakeEvent {
  const tripId = options.tripId ?? TRIP_ID
  const userId = options.userId === undefined ? OWNER_ID : options.userId
  request = { tripId, userId: userId ?? "" }
  return {
    context: {
      params: {
        id: tripId,
        expenseId: options.expenseId ?? EXPENSE_ID,
        attachmentId: options.attachmentId ?? ATTACHMENT_ID,
      },
      userId,
      headers: options.headers ?? {},
      parts: options.parts ?? [filePart()],
    },
    responseHeaders: {},
  }
}

async function assertStatus(promise: Promise<unknown>, statusCode: number): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.equal((error as { statusCode?: number }).statusCode, statusCode)
    return true
  })
}

beforeEach(() => {
  installFakeDb()
  seed()
})

afterAll(restoreDb)

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

describe("POST receipt", () => {
  it("stores the file and returns metadata without the storage key", async () => {
    const result = await uploadReceipt(makeEvent())
    assert.equal(result.fileName, "receipt.png")
    assert.equal(result.mimeType, "image/png")
    assert.equal(result.sizeBytes, PNG_BYTES.byteLength)
    assert.equal(result.uploadedById, OWNER_ID)
    assert.equal(store.attachments.length, 1)
    assert.ok(!("storageKey" in result), "the storage key must not reach the client")
    assert.equal(
      result.url,
      `/api/trips/${TRIP_ID}/expenses/${EXPENSE_ID}/attachments/${result.id}`,
    )
  })

  it("writes the bytes to the object store", async () => {
    await uploadReceipt(makeEvent())
    const key = store.attachments[0]?.storageKey ?? ""
    const stored = await memoryReceiptStorage.get(key)
    assert.deepEqual(stored?.body, PNG_BYTES)
    assert.equal(stored?.contentType, "image/png")
  })

  it("lets an editor upload", async () => {
    await uploadReceipt(makeEvent({ userId: EDITOR_ID }))
    assert.equal(store.attachments.length, 1)
  })

  // A viewer can read the trip's finances; they cannot add to them.
  it("403s for a viewer, and writes nothing", async () => {
    await assertStatus(uploadReceipt(makeEvent({ userId: VIEWER_ID })), 403)
    assert.equal(store.attachments.length, 0)
    assert.equal(memoryReceiptStorage.size(), 0)
  })

  it("404s for a non-member without revealing the trip exists", async () => {
    await assertStatus(uploadReceipt(makeEvent({ userId: STRANGER_ID })), 404)
    assert.equal(store.attachments.length, 0)
  })

  it("401s when unauthenticated", async () => {
    await assertStatus(uploadReceipt(makeEvent({ userId: null })), 401)
  })

  // The owner of another trip cannot post a receipt onto this one's expense.
  it("404s when the expense belongs to a different trip", async () => {
    await assertStatus(
      uploadReceipt(
        makeEvent({ userId: OUTSIDER_ID, tripId: OTHER_TRIP_ID, expenseId: EXPENSE_ID }),
      ),
      404,
    )
    assert.equal(store.attachments.length, 0)
    assert.equal(memoryReceiptStorage.size(), 0)
  })

  it("rejects a file whose bytes are not an allowed type", async () => {
    await assertStatus(
      uploadReceipt(
        makeEvent({
          parts: [
            filePart({
              filename: "receipt.png",
              type: "image/png",
              data: new TextEncoder().encode("<html>not a png</html>"),
            }),
          ],
        }),
      ),
      400,
    )
    assert.equal(memoryReceiptStorage.size(), 0, "nothing may be written before validation passes")
  })

  it("rejects an executable renamed to .png", async () => {
    await assertStatus(
      uploadReceipt(
        makeEvent({
          parts: [
            filePart({ type: undefined, data: new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]) }),
          ],
        }),
      ),
      400,
    )
  })

  it("rejects an oversized body from its declared length, before reading it", async () => {
    await assertStatus(
      uploadReceipt(makeEvent({ headers: { "content-length": String(RECEIPT_MAX_BYTES * 10) } })),
      413,
    )
    assert.equal(store.attachments.length, 0)
  })

  it("rejects oversized bytes even when the declared length lied", async () => {
    const huge = new Uint8Array(RECEIPT_MAX_BYTES + 1)
    huge.set(PNG_BYTES)
    await assertStatus(
      uploadReceipt(
        makeEvent({ headers: { "content-length": "10" }, parts: [filePart({ data: huge })] }),
      ),
      413,
    )
    assert.equal(store.attachments.length, 0)
  })

  it("rejects a request with no file part", async () => {
    await assertStatus(uploadReceipt(makeEvent({ parts: [] })), 400)
    await assertStatus(
      uploadReceipt(makeEvent({ parts: [{ name: "notes", data: PNG_BYTES }] })),
      400,
    )
  })

  it("strips a directory traversal out of the filename", async () => {
    const result = await uploadReceipt(
      makeEvent({ parts: [filePart({ filename: "../../../etc/passwd.png" })] }),
    )
    assert.equal(result.fileName, "passwd.png")
  })

  it("caps how many receipts one expense can hold", async () => {
    for (let i = 0; i < RECEIPT_MAX_PER_EXPENSE; i += 1) {
      await uploadReceipt(makeEvent())
    }
    await assertStatus(uploadReceipt(makeEvent()), 400)
    assert.equal(store.attachments.length, RECEIPT_MAX_PER_EXPENSE)
  })

  it("audits the upload", async () => {
    await uploadReceipt(makeEvent({ userId: EDITOR_ID }))
    const entry = store.log.at(-1)
    assert.equal(entry?.action, "expense_receipt_added")
    assert.equal(entry?.userId, EDITOR_ID)
    assert.equal(entry?.metadata?.expenseId, EXPENSE_ID)
  })

  it("accepts a PDF", async () => {
    const result = await uploadReceipt(
      makeEvent({
        parts: [filePart({ filename: "bill.pdf", type: "application/pdf", data: PDF_BYTES })],
      }),
    )
    assert.equal(result.mimeType, "application/pdf")
  })
})

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

describe("GET receipts", () => {
  it("lists this expense's receipts", async () => {
    seed({ attachments: [makeAttachment()] })
    const result = await listReceipts(makeEvent())
    assert.deepEqual(
      result.map((a) => a.id),
      [ATTACHMENT_ID],
    )
  })

  it("is readable by a viewer", async () => {
    seed({ attachments: [makeAttachment()] })
    assert.equal((await listReceipts(makeEvent({ userId: VIEWER_ID }))).length, 1)
  })

  it("404s for a non-member", async () => {
    seed({ attachments: [makeAttachment()] })
    await assertStatus(listReceipts(makeEvent({ userId: STRANGER_ID })), 404)
  })

  // The trip is in the `where`, not only the expense: a member of trip A asking
  // for an expense of trip B must not be handed B's receipts.
  it("never lists another trip's receipts", async () => {
    seed({
      attachments: [
        makeAttachment(),
        makeAttachment({
          id: OTHER_ATTACHMENT_ID,
          tripId: OTHER_TRIP_ID,
          expenseId: OTHER_EXPENSE_ID,
          storageKey: "receipts/other/seeded",
        }),
      ],
    })
    const result = await listReceipts(makeEvent())
    assert.deepEqual(
      result.map((a) => a.id),
      [ATTACHMENT_ID],
    )
  })

  it("404s when the expense is not on this trip", async () => {
    seed({ attachments: [makeAttachment()] })
    await assertStatus(listReceipts(makeEvent({ expenseId: OTHER_EXPENSE_ID })), 404)
  })
})

// ---------------------------------------------------------------------------
// Read — the endpoint a leak would come from
// ---------------------------------------------------------------------------

describe("GET receipt bytes", () => {
  it("serves the bytes to a member", async () => {
    seed({ attachments: [makeAttachment()] })
    const event = makeEvent()
    const body = await readReceipt(event)
    assert.deepEqual(new Uint8Array(body), PNG_BYTES)
    assert.equal(event.responseHeaders["Content-Type"], "image/png")
  })

  it("serves the bytes to a viewer", async () => {
    seed({ attachments: [makeAttachment()] })
    const body = await readReceipt(makeEvent({ userId: VIEWER_ID }))
    assert.deepEqual(new Uint8Array(body), PNG_BYTES)
  })

  it("404s for a stranger", async () => {
    seed({ attachments: [makeAttachment()] })
    await assertStatus(readReceipt(makeEvent({ userId: STRANGER_ID })), 404)
  })

  it("401s when unauthenticated", async () => {
    seed({ attachments: [makeAttachment()] })
    await assertStatus(readReceipt(makeEvent({ userId: null })), 401)
  })

  // The attachment id is real and the caller is a legitimate owner — of the
  // *other* trip. This is the leak the (trip, expense, attachment) lookup exists
  // to prevent.
  it("404s when a member of another trip names this trip's attachment id", async () => {
    seed({ attachments: [makeAttachment()] })
    await assertStatus(
      readReceipt(
        makeEvent({
          userId: OUTSIDER_ID,
          tripId: OTHER_TRIP_ID,
          expenseId: OTHER_EXPENSE_ID,
          attachmentId: ATTACHMENT_ID,
        }),
      ),
      404,
    )
  })

  // The sharpest version: the attacker knows the real expense id *and* the real
  // attachment id, and supplies a trip they legitimately own. Only the `trip_id`
  // half of the predicate stands between them and the file.
  it("404s when a trip id they do own is paired with another trip's expense and attachment", async () => {
    seed({ attachments: [makeAttachment()] })
    await assertStatus(
      readReceipt(
        makeEvent({
          userId: OUTSIDER_ID,
          tripId: OTHER_TRIP_ID,
          expenseId: EXPENSE_ID,
          attachmentId: ATTACHMENT_ID,
        }),
      ),
      404,
    )
  })

  it("404s when the attachment is addressed through the wrong expense of the same trip", async () => {
    seed({
      expenses: [
        { id: EXPENSE_ID, tripId: TRIP_ID },
        { id: OTHER_EXPENSE_ID, tripId: TRIP_ID },
      ],
      attachments: [makeAttachment()],
    })
    await assertStatus(readReceipt(makeEvent({ expenseId: OTHER_EXPENSE_ID })), 404)
  })

  it("404s for an attachment id that does not exist", async () => {
    seed({ attachments: [makeAttachment()] })
    await assertStatus(readReceipt(makeEvent({ attachmentId: OTHER_ATTACHMENT_ID })), 404)
  })

  it("404s when the row survived but the object did not", async () => {
    seed({ attachments: [makeAttachment()] })
    memoryReceiptStorage.clear()
    await assertStatus(readReceipt(makeEvent()), 404)
  })

  it("sends an image inline, sandboxed and un-sniffable", async () => {
    seed({ attachments: [makeAttachment()] })
    const event = makeEvent()
    await readReceipt(event)
    assert.equal(event.responseHeaders["X-Content-Type-Options"], "nosniff")
    assert.match(event.responseHeaders["Content-Disposition"] ?? "", /^inline; filename="receipt/)
    assert.match(event.responseHeaders["Content-Security-Policy"] ?? "", /sandbox/)
    assert.match(event.responseHeaders["Cache-Control"] ?? "", /private/)
  })

  // A PDF opened inline runs in a scripting-capable viewer on our own origin.
  it("forces a PDF to download rather than render in place", async () => {
    seed({
      attachments: [makeAttachment({ mimeType: "application/pdf", fileName: "bill.pdf" })],
    })
    const event = makeEvent()
    await readReceipt(event)
    assert.match(event.responseHeaders["Content-Disposition"] ?? "", /^attachment; /)
  })
})

// ---------------------------------------------------------------------------
// The public share link
// ---------------------------------------------------------------------------

// `server/api/shared/[token].get.ts` is unauthenticated and its token is
// forwardable by design. It already returns no finances; receipts must not be
// the thing that changes that, and a receipt is worse than a number — it
// carries card digits, an address and a name. This reads the handler rather
// than calling it: the guarantee is that the code never touches expenses at
// all, which is stronger than any single response being clean.
describe("public share link", () => {
  it("never reaches expenses or their receipts", async () => {
    const source = await Bun.file(new URL("../api/shared/[token].get.ts", import.meta.url)).text()
    for (const forbidden of ["expense", "attachment", "receipt", "budget"]) {
      assert.ok(
        !source.toLowerCase().includes(forbidden),
        `the public share endpoint must not mention ${forbidden}`,
      )
    }
  })
})

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

describe("DELETE receipt", () => {
  it("removes the row and the object", async () => {
    seed({ attachments: [makeAttachment()] })
    const key = makeAttachment().storageKey
    assert.deepEqual(await deleteReceipt(makeEvent()), { success: true })
    assert.equal(store.attachments.length, 0)
    assert.equal(await memoryReceiptStorage.get(key), null)
  })

  it("403s for a viewer", async () => {
    seed({ attachments: [makeAttachment()] })
    await assertStatus(deleteReceipt(makeEvent({ userId: VIEWER_ID })), 403)
    assert.equal(store.attachments.length, 1)
  })

  it("404s for a stranger, leaving the receipt alone", async () => {
    seed({ attachments: [makeAttachment()] })
    await assertStatus(deleteReceipt(makeEvent({ userId: STRANGER_ID })), 404)
    assert.equal(store.attachments.length, 1)
  })

  it("404s when another trip's owner names this attachment id", async () => {
    seed({ attachments: [makeAttachment()] })
    await assertStatus(
      deleteReceipt(
        makeEvent({
          userId: OUTSIDER_ID,
          tripId: OTHER_TRIP_ID,
          expenseId: OTHER_EXPENSE_ID,
          attachmentId: ATTACHMENT_ID,
        }),
      ),
      404,
    )
    assert.equal(store.attachments.length, 1, "the receipt must still be there")
  })

  it("404s when a trip they own is paired with another trip's expense and attachment", async () => {
    seed({ attachments: [makeAttachment()] })
    await assertStatus(
      deleteReceipt(
        makeEvent({
          userId: OUTSIDER_ID,
          tripId: OTHER_TRIP_ID,
          expenseId: EXPENSE_ID,
          attachmentId: ATTACHMENT_ID,
        }),
      ),
      404,
    )
    assert.equal(store.attachments.length, 1)
    assert.equal(memoryReceiptStorage.size(), 1, "the bytes must still be there")
  })

  it("404s on a repeat delete rather than reporting success twice", async () => {
    seed({ attachments: [makeAttachment()] })
    await deleteReceipt(makeEvent())
    await assertStatus(deleteReceipt(makeEvent()), 404)
  })

  it("audits the deletion", async () => {
    seed({ attachments: [makeAttachment()] })
    await deleteReceipt(makeEvent({ userId: EDITOR_ID }))
    const entry = store.log.at(-1)
    assert.equal(entry?.action, "expense_receipt_deleted")
    assert.equal(entry?.userId, EDITOR_ID)
  })
})
