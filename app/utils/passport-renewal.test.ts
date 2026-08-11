import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  RENEWAL_LEAD_MONTHS,
  buildPassportRenewal,
  buildPassportRenewals,
} from "./passport-renewal"

const NOW = new Date(2026, 7, 11) // 2026-08-11

describe("passport renewal", () => {
  it("recommends renewing the full lead time before expiry", () => {
    const renewal = buildPassportRenewal(
      { countryCode: "MY", expiryDate: "2030-06-15", isDefault: true },
      NOW,
    )

    assert.equal(RENEWAL_LEAD_MONTHS, 9)
    assert.equal(renewal.recommendedRenewalDate, "2029-09-15")
    assert.equal(renewal.status, "valid")
  })

  it("clamps the recommended date when the lead time overflows a short month", () => {
    // 2027-03-31 minus 9 months lands in June, which has no 31st.
    const renewal = buildPassportRenewal(
      { countryCode: "MY", expiryDate: "2027-03-31", isDefault: false },
      NOW,
    )

    assert.equal(renewal.recommendedRenewalDate, "2026-06-30")
  })

  it("opens the renewal window nine months out", () => {
    const outside = buildPassportRenewal(
      { countryCode: "MY", expiryDate: "2027-05-12", isDefault: false },
      NOW,
    )
    const inside = buildPassportRenewal(
      { countryCode: "MY", expiryDate: "2027-05-10", isDefault: false },
      NOW,
    )

    assert.equal(outside.status, "valid")
    assert.equal(inside.status, "plan")
  })

  it("flags passports below the six-month validity rule", () => {
    const renewal = buildPassportRenewal(
      { countryCode: "MY", expiryDate: "2027-01-20", isDefault: false },
      NOW,
    )

    assert.equal(renewal.status, "urgent")
    assert.equal(renewal.tone, "warn")
  })

  it("escalates inside three months and after expiry", () => {
    const critical = buildPassportRenewal(
      { countryCode: "MY", expiryDate: "2026-10-01", isDefault: false },
      NOW,
    )
    const expired = buildPassportRenewal(
      { countryCode: "MY", expiryDate: "2026-08-10", isDefault: false },
      NOW,
    )

    assert.equal(critical.status, "critical")
    assert.equal(expired.status, "expired")
    assert.equal(expired.daysUntilExpiry, -1)
  })

  it("reports a missing expiry date instead of guessing one", () => {
    const renewal = buildPassportRenewal(
      { countryCode: "MY", expiryDate: null, isDefault: false },
      NOW,
    )

    assert.equal(renewal.status, "unknown")
    assert.equal(renewal.recommendedRenewalDate, null)
    assert.equal(renewal.daysUntilExpiry, null)
  })

  it("resolves country name and flag from the alpha-2 code", () => {
    const renewal = buildPassportRenewal(
      { countryCode: "my", expiryDate: "2030-01-01", isDefault: false },
      NOW,
    )

    assert.equal(renewal.countryCode, "MY")
    assert.equal(renewal.countryName, "Malaysia")
    assert.equal(renewal.flag, "🇲🇾")
  })

  it("counts whole months remaining", () => {
    const renewal = buildPassportRenewal(
      { countryCode: "MY", expiryDate: "2027-01-10", isDefault: false },
      NOW,
    )

    // 2026-08-11 → 2027-01-10 is four full months plus 30 days.
    assert.equal(renewal.monthsUntilExpiry, 4)
  })

  it("sorts the most urgent passport first and unknown expiries last", () => {
    const renewals = buildPassportRenewals(
      [
        { countryCode: "SG", expiryDate: null, isDefault: false },
        { countryCode: "MY", expiryDate: "2032-01-01", isDefault: true },
        { countryCode: "GB", expiryDate: "2026-09-01", isDefault: false },
        { countryCode: "AU", expiryDate: "2027-02-01", isDefault: false },
      ],
      NOW,
    )

    assert.deepEqual(
      renewals.map((r) => r.countryCode),
      ["GB", "AU", "MY", "SG"],
    )
  })

  it("returns an empty list for missing input", () => {
    assert.deepEqual(buildPassportRenewals(null, NOW), [])
    assert.deepEqual(buildPassportRenewals(undefined, NOW), [])
  })
})
