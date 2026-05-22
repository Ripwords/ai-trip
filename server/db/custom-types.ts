import { customType } from "drizzle-orm/pg-core"
import { encrypt, decrypt } from "../lib/encryption"

/**
 * Custom Drizzle column type for AES-256-GCM encrypted text fields.
 * Data is encrypted before writing to the DB and decrypted on read.
 * Requires ENCRYPTION_KEY environment variable.
 */
export function encryptedText(name: string) {
  return customType<{
    data: string
    driverData: string
  }>({
    dataType() {
      return "text"
    },
    fromDriver(value: string): string {
      if (!value) return value
      if (!process.env.ENCRYPTION_KEY) {
        throw new Error("ENCRYPTION_KEY environment variable is not set")
      }
      try {
        return decrypt(value, process.env.ENCRYPTION_KEY)
      } catch (e) {
        // Sanitized re-throw: raw OpenSSL messages distinguish auth-tag
        // mismatch from ciphertext malformation (a minor decryption oracle).
        // Log the original server-side only; do NOT attach `cause` here.
        console.error("[encryptedText] decryption failed", e)
        // eslint-disable-next-line preserve-caught-error -- intentional: cause leaks oracle detail
        throw new Error("Decryption failed")
      }
    },
    toDriver(value: string): string {
      if (!value) return value
      if (!process.env.ENCRYPTION_KEY) {
        throw new Error("ENCRYPTION_KEY environment variable is not set")
      }
      return encrypt(value, process.env.ENCRYPTION_KEY)
    },
  })(name)
}
