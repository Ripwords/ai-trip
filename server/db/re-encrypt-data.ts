/**
 * Re-encryption script for migrating encrypted data after key derivation change.
 *
 * The key derivation was changed from SHA-256 hash to HKDF. This script:
 * 1. Reads all encrypted columns using raw SQL (bypassing Drizzle's custom type)
 * 2. Tries decrypting with the new HKDF key — skips if already migrated
 * 3. Decrypts with the old SHA-256 key derivation
 * 4. Re-encrypts with the new HKDF key derivation
 *
 * Idempotent — safe to run multiple times.
 *
 * Usage: npx tsx server/db/re-encrypt-data.ts
 * Requires DATABASE_URL and ENCRYPTION_KEY env vars.
 */
// eslint-disable-next-line eslint-plugin-import(no-unassigned-import)
import "dotenv/config"
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "crypto"
import { Pool, PoolClient } from "pg"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12

const databaseUrl = process.env.DATABASE_URL
const encryptionKey = process.env.ENCRYPTION_KEY!

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set")
}
if (!encryptionKey) {
  throw new Error("ENCRYPTION_KEY is not set")
}

// Old key derivation: SHA-256 hash of the raw secret string
function deriveKeyOld(secret: string): Buffer {
  return createHash("sha256").update(secret).digest()
}

// New key derivation: HKDF with base64-decoded key material
function deriveKeyNew(secret: string): Buffer {
  const keyMaterial = Buffer.from(secret, "base64")
  return Buffer.from(hkdfSync("sha256", keyMaterial, Buffer.alloc(0), "ai-trip-encryption-v1", 32))
}

function decryptWithKey(payload: string, key: Buffer): string {
  const buffer = Buffer.from(payload, "base64")
  const iv = buffer.subarray(0, IV_LENGTH)
  const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + 16)
  const ciphertext = buffer.subarray(IV_LENGTH + 16)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return decrypted.toString("utf8")
}

function encryptWithKey(value: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()

  return Buffer.concat([iv, authTag, encrypted]).toString("base64")
}

interface EncryptedColumn {
  table: string
  column: string
  idColumn: string
}

const ENCRYPTED_COLUMNS: EncryptedColumn[] = [
  { table: "user_passports", column: "passport_number", idColumn: "id" },
  { table: "reservations", column: "confirmation_number", idColumn: "id" },
]

async function reEncryptTable(
  client: PoolClient,
  { table, column, idColumn }: EncryptedColumn,
  oldKey: Buffer,
  newKey: Buffer,
): Promise<number> {
  const { rows } = await client.query(
    `SELECT "${idColumn}", "${column}" FROM "${table}" WHERE "${column}" IS NOT NULL`,
  )

  let updated = 0
  let skipped = 0
  for (const row of rows) {
    const ciphertext = row[column] as string

    // Already migrated — decrypts fine with the new key
    try {
      decryptWithKey(ciphertext, newKey)
      skipped++
      continue
    } catch {
      // Expected — needs re-encryption
    }

    try {
      const plaintext = decryptWithKey(ciphertext, oldKey)
      const newCiphertext = encryptWithKey(plaintext, newKey)
      await client.query(`UPDATE "${table}" SET "${column}" = $1 WHERE "${idColumn}" = $2`, [
        newCiphertext,
        row[idColumn],
      ])
      updated++
    } catch {
      console.error(`  Failed to re-encrypt ${table}.${idColumn}=${row[idColumn]} — skipping`)
    }
  }

  if (skipped > 0) {
    console.log(`  Skipped ${skipped} already-migrated rows`)
  }

  return updated
}

async function main() {
  const oldKey = deriveKeyOld(encryptionKey)
  const newKey = deriveKeyNew(encryptionKey)

  const pool = new Pool({ connectionString: databaseUrl })
  const client = await pool.connect()

  try {
    await client.query("BEGIN")

    for (const col of ENCRYPTED_COLUMNS) {
      console.log(`Re-encrypting ${col.table}.${col.column}...`)
      const count = await reEncryptTable(client, col, oldKey, newKey)
      console.log(`  Updated ${count} rows`)
    }

    await client.query("COMMIT")
    console.log("Re-encryption complete.")
  } catch (error) {
    await client.query("ROLLBACK")
    console.error("Re-encryption failed, rolled back:", error)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

main()
