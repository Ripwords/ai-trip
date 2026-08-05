/**
 * Upload policy for expense receipts — issue #48.
 *
 * Everything here is adversarial input: the filename, the declared content
 * type and the bytes all come from whoever is posting the form.
 */

import assert from "node:assert/strict"
import { describe, it } from "bun:test"
import {
  RECEIPT_ALLOWED_MIME_TYPES,
  RECEIPT_MAX_BYTES,
  RECEIPT_MAX_PER_EXPENSE,
  sanitiseReceiptFileName,
  sniffReceiptMimeType,
  validateReceiptUpload,
} from "./receipts"

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
const PDF = new TextEncoder().encode("%PDF-1.7\n trailer")
const WEBP = new Uint8Array([
  ...new TextEncoder().encode("RIFF"),
  0x24,
  0,
  0,
  0,
  ...new TextEncoder().encode("WEBP"),
])
const HTML = new TextEncoder().encode("<html><script>alert(1)</script></html>")
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')

describe("sniffReceiptMimeType", () => {
  it("recognises the formats we accept from their magic bytes", () => {
    assert.equal(sniffReceiptMimeType(PNG), "image/png")
    assert.equal(sniffReceiptMimeType(JPEG), "image/jpeg")
    assert.equal(sniffReceiptMimeType(PDF), "application/pdf")
    assert.equal(sniffReceiptMimeType(WEBP), "image/webp")
  })

  it("does not recognise anything else", () => {
    assert.equal(sniffReceiptMimeType(HTML), null)
    // SVG is an image the browser will execute scripts inside. It is not on the
    // list, and sniffing must not be talked into it by an XML preamble.
    assert.equal(sniffReceiptMimeType(SVG), null)
    assert.equal(sniffReceiptMimeType(new Uint8Array()), null)
    assert.equal(sniffReceiptMimeType(new Uint8Array([0xff, 0xd8])), null, "truncated JPEG")
  })

  it("does not mistake a RIFF container that is not WebP", () => {
    const wav = new Uint8Array([
      ...new TextEncoder().encode("RIFF"),
      0x24,
      0,
      0,
      0,
      ...new TextEncoder().encode("WAVE"),
    ])
    assert.equal(sniffReceiptMimeType(wav), null)
  })
})

describe("validateReceiptUpload", () => {
  it("accepts a plain png", () => {
    const result = validateReceiptUpload({
      fileName: "receipt.png",
      declaredType: "image/png",
      bytes: PNG,
    })
    assert.equal(result.mimeType, "image/png")
    assert.equal(result.fileName, "receipt.png")
    assert.equal(result.sizeBytes, PNG.byteLength)
  })

  // The whole point of sniffing: `Content-Type` in a multipart part is a claim
  // by the uploader, not a fact about the bytes.
  it("rejects html wearing an image/png label", () => {
    assert.throws(
      () =>
        validateReceiptUpload({ fileName: "receipt.png", declaredType: "image/png", bytes: HTML }),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 400,
    )
  })

  it("rejects a real png that claims to be something we do not allow", () => {
    assert.throws(() =>
      validateReceiptUpload({
        fileName: "receipt.png",
        declaredType: "application/x-msdownload",
        bytes: PNG,
      }),
    )
  })

  it("trusts the bytes over the extension", () => {
    const result = validateReceiptUpload({
      fileName: "receipt.pdf",
      declaredType: "application/pdf",
      bytes: PDF,
    })
    assert.equal(result.mimeType, "application/pdf")
  })

  it("rejects a file larger than the limit", () => {
    const oversized = new Uint8Array(RECEIPT_MAX_BYTES + 1)
    oversized.set(PNG)
    assert.throws(
      () =>
        validateReceiptUpload({
          fileName: "big.png",
          declaredType: "image/png",
          bytes: oversized,
        }),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 413,
    )
  })

  it("accepts a file exactly at the limit", () => {
    const exact = new Uint8Array(RECEIPT_MAX_BYTES)
    exact.set(PNG)
    assert.equal(
      validateReceiptUpload({ fileName: "big.png", declaredType: "image/png", bytes: exact })
        .sizeBytes,
      RECEIPT_MAX_BYTES,
    )
  })

  it("rejects an empty file", () => {
    assert.throws(() =>
      validateReceiptUpload({
        fileName: "x.png",
        declaredType: "image/png",
        bytes: new Uint8Array(),
      }),
    )
  })

  it("only allows the four types it advertises", () => {
    assert.deepEqual([...RECEIPT_ALLOWED_MIME_TYPES].toSorted(), [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
    ])
  })

  it("caps how many receipts one expense can carry", () => {
    assert.ok(RECEIPT_MAX_PER_EXPENSE >= 1 && RECEIPT_MAX_PER_EXPENSE <= 10)
  })
})

describe("sanitiseReceiptFileName", () => {
  it("keeps an ordinary name", () => {
    assert.equal(sanitiseReceiptFileName("Taxi receipt (2).pdf"), "Taxi receipt (2).pdf")
  })

  it("strips directory components rather than escaping them", () => {
    assert.equal(sanitiseReceiptFileName("../../etc/passwd"), "passwd")
    assert.equal(sanitiseReceiptFileName("C:\\Windows\\system32\\evil.png"), "evil.png")
  })

  it("removes control characters and quotes, which would break the download header", () => {
    assert.equal(sanitiseReceiptFileName('re"ce\nipt.png'), "receipt.png")
  })

  it("falls back to a default when nothing usable is left", () => {
    assert.equal(sanitiseReceiptFileName(""), "receipt")
    assert.equal(sanitiseReceiptFileName("///"), "receipt")
  })

  it("truncates a hostile length", () => {
    const long = `${"a".repeat(500)}.png`
    const result = sanitiseReceiptFileName(long)
    assert.ok(result.length <= 120, `got ${result.length}`)
  })
})
