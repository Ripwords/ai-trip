import { eq, inArray } from "drizzle-orm"
import { db } from "../db"
import { storedObjects } from "../db/schema"

/**
 * Where receipt bytes live — issue #48.
 *
 * ---------------------------------------------------------------------------
 * STORAGE DECISION — OPEN, AND DELIBERATELY NOT MADE HERE
 * ---------------------------------------------------------------------------
 * This project had no blob storage of any kind when receipts were added: no
 * `@vercel/blob`, no S3 client, no bucket in `.env.example`, and nothing in
 * `nuxt.config.ts` beyond a single `*.public.blob.vercel-storage.com` entry in
 * the CSP `connect-src` that nothing has ever used. Picking a paid vendor and
 * signing the project up for it is not a decision an implementation branch gets
 * to make.
 *
 * So the bytes go in Postgres by default (`stored_objects`), behind this
 * interface. That works everywhere the app already runs — local docker and the
 * existing Neon database — with no new account and no new dependency, and it is
 * bounded by policy rather than by hope: 5 MB per file, 5 files per expense,
 * 200 expenses per trip (server/lib/receipts.ts, server/lib/expense-cap.ts).
 *
 * It is *not* what a mature deployment should run. Receipt bytes in the primary
 * database inflate backups, restores and Neon storage cost, and every read goes
 * through the connection pool instead of a CDN. Binding `RECEIPT_STORAGE_DRIVER`
 * to a real object store — Vercel Blob, S3, R2 — is the production decision,
 * and it is a new file implementing `ReceiptStorage` plus a line in the factory
 * below. Nothing outside this module knows where the bytes are.
 */

export interface StoredReceipt {
  body: Uint8Array
  contentType: string
}

export interface ReceiptStorage {
  /** For logs and for the report that says which binding is live. */
  readonly name: string
  put(key: string, body: Uint8Array, contentType: string): Promise<void>
  get(key: string): Promise<StoredReceipt | null>
  /**
   * Best-effort. Storage is cleaned up *after* the database rows are gone, so
   * a failure here leaks an object rather than leaving a row pointing at
   * nothing — the safe direction of the two.
   */
  delete(keys: string[]): Promise<void>
}

/**
 * Opaque, unguessable, and namespaced by trip so a future object-store binding
 * can map it straight onto a prefix. It is never used for authorisation — the
 * database row is — but there is no reason to make it enumerable either.
 */
export function receiptStorageKey(tripId: string, expenseId: string): string {
  return `receipts/${tripId}/${expenseId}/${crypto.randomUUID()}`
}

/** The default binding. See the note above before assuming it is the right one. */
const databaseStorage: ReceiptStorage = {
  name: "database",

  async put(key, body, contentType) {
    await db.insert(storedObjects).values({
      key,
      contentType,
      sizeBytes: body.byteLength,
      data: Buffer.from(body),
    })
  },

  async get(key) {
    const row = await db.query.storedObjects.findFirst({
      where: eq(storedObjects.key, key),
    })
    if (!row) return null
    return { body: new Uint8Array(row.data), contentType: row.contentType }
  },

  async delete(keys) {
    if (keys.length === 0) return
    await db.delete(storedObjects).where(inArray(storedObjects.key, keys))
  },
}

export interface MemoryReceiptStorage extends ReceiptStorage {
  clear(): void
  size(): number
}

/**
 * A process-local store, for tests and throwaway environments. It exists to
 * keep this interface honest — a second implementation is what proves the
 * handlers do not know where the bytes are — and it is never a production
 * choice: the contents vanish with the process.
 */
export function createMemoryReceiptStorage(): MemoryReceiptStorage {
  const entries = new Map<string, StoredReceipt>()
  return {
    name: "memory",
    async put(key, body, contentType) {
      entries.set(key, { body: new Uint8Array(body), contentType })
    },
    async get(key) {
      const entry = entries.get(key)
      return entry ? { body: new Uint8Array(entry.body), contentType: entry.contentType } : null
    },
    async delete(keys) {
      for (const key of keys) entries.delete(key)
    },
    clear: () => entries.clear(),
    size: () => entries.size,
  }
}

export const memoryReceiptStorage = createMemoryReceiptStorage()

/**
 * The configured store. `RECEIPT_STORAGE_DRIVER` exists so a deployment can
 * declare its choice explicitly rather than inheriting a default silently; an
 * unrecognised value is a misconfiguration and is refused loudly.
 */
export function getReceiptStorage(): ReceiptStorage {
  const driver = process.env.RECEIPT_STORAGE_DRIVER || "database"
  if (driver === "database") return databaseStorage
  if (driver === "memory") return memoryReceiptStorage
  throw createError({
    statusCode: 500,
    message: `Unknown receipt storage driver: ${driver}`,
  })
}
