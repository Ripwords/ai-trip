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
      return decrypt(value, process.env.ENCRYPTION_KEY)
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
