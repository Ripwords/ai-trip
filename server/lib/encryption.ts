import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12

// NOTE: Changing this function requires re-encrypting all existing data
function deriveKey(secret: string): Buffer {
  const keyMaterial = Buffer.from(secret, "base64")
  return Buffer.from(hkdfSync("sha256", keyMaterial, Buffer.alloc(0), "ai-trip-encryption-v1", 32))
}

export function encrypt(value: string, secret: string): string {
  const key = deriveKey(secret)
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()

  return Buffer.concat([iv, authTag, encrypted]).toString("base64")
}

export function decrypt(payload: string, secret: string): string {
  const key = deriveKey(secret)
  const buffer = Buffer.from(payload, "base64")

  const iv = buffer.subarray(0, IV_LENGTH)
  const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + 16)
  const ciphertext = buffer.subarray(IV_LENGTH + 16)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return decrypted.toString("utf8")
}
