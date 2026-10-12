/**
 * IANA time zone of every airport in `iata-country-map.ts`. Flighty exports
 * gate times as each airport's local wall clock with no offset, so turning
 * them into instants needs the zone; the offset itself (and daylight saving
 * on the day) comes from `Intl`.
 */
export const AIRPORT_TIMEZONES: Readonly<Record<string, string>> = {
  // United States
  ATL: "America/New_York",
  LAX: "America/Los_Angeles",
  ORD: "America/Chicago",
  DFW: "America/Chicago",
  DEN: "America/Denver",
  JFK: "America/New_York",
  SFO: "America/Los_Angeles",
  SEA: "America/Los_Angeles",
  LAS: "America/Los_Angeles",
  MCO: "America/New_York",
  EWR: "America/New_York",
  MIA: "America/New_York",
  IAH: "America/Chicago",
  BOS: "America/New_York",
  MSP: "America/Chicago",
  DTW: "America/Detroit",
  PHL: "America/New_York",
  CLT: "America/New_York",
  IAD: "America/New_York",
  SAN: "America/Los_Angeles",
  HNL: "Pacific/Honolulu",
  // United Kingdom
  LHR: "Europe/London",
  LGW: "Europe/London",
  STN: "Europe/London",
  MAN: "Europe/London",
  EDI: "Europe/London",
  // Japan
  NRT: "Asia/Tokyo",
  HND: "Asia/Tokyo",
  KIX: "Asia/Tokyo",
  CTS: "Asia/Tokyo",
  FUK: "Asia/Tokyo",
  NGO: "Asia/Tokyo",
  // China, Hong Kong, Taiwan
  PEK: "Asia/Shanghai",
  PVG: "Asia/Shanghai",
  CAN: "Asia/Shanghai",
  CTU: "Asia/Shanghai",
  SZX: "Asia/Shanghai",
  HKG: "Asia/Hong_Kong",
  TPE: "Asia/Taipei",
  TSA: "Asia/Taipei",
  // South Korea
  ICN: "Asia/Seoul",
  GMP: "Asia/Seoul",
  PUS: "Asia/Seoul",
  // Southeast Asia
  SIN: "Asia/Singapore",
  BKK: "Asia/Bangkok",
  DMK: "Asia/Bangkok",
  CNX: "Asia/Bangkok",
  HKT: "Asia/Bangkok",
  KUL: "Asia/Kuala_Lumpur",
  PEN: "Asia/Kuala_Lumpur",
  LGK: "Asia/Kuala_Lumpur",
  SZB: "Asia/Kuala_Lumpur",
  BKI: "Asia/Kuching",
  KCH: "Asia/Kuching",
  CGK: "Asia/Jakarta",
  SUB: "Asia/Jakarta",
  DPS: "Asia/Makassar",
  SGN: "Asia/Ho_Chi_Minh",
  HAN: "Asia/Ho_Chi_Minh",
  DAD: "Asia/Ho_Chi_Minh",
  MNL: "Asia/Manila",
  CEB: "Asia/Manila",
  PNH: "Asia/Phnom_Penh",
  REP: "Asia/Phnom_Penh",
  RGN: "Asia/Yangon",
  VTE: "Asia/Vientiane",
  LPQ: "Asia/Vientiane",
  // South Asia
  DEL: "Asia/Kolkata",
  BOM: "Asia/Kolkata",
  BLR: "Asia/Kolkata",
  MAA: "Asia/Kolkata",
  CCU: "Asia/Kolkata",
  HYD: "Asia/Kolkata",
  CMB: "Asia/Colombo",
  MLE: "Indian/Maldives",
  KTM: "Asia/Kathmandu",
  DAC: "Asia/Dhaka",
  ISB: "Asia/Karachi",
  KHI: "Asia/Karachi",
  LHE: "Asia/Karachi",
  // Oceania
  SYD: "Australia/Sydney",
  MEL: "Australia/Melbourne",
  BNE: "Australia/Brisbane",
  PER: "Australia/Perth",
  AKL: "Pacific/Auckland",
  CHC: "Pacific/Auckland",
  WLG: "Pacific/Auckland",
  NAN: "Pacific/Fiji",
  // Middle East
  DXB: "Asia/Dubai",
  AUH: "Asia/Dubai",
  SHJ: "Asia/Dubai",
  DOH: "Asia/Qatar",
  RUH: "Asia/Riyadh",
  JED: "Asia/Riyadh",
  TLV: "Asia/Jerusalem",
  // Turkey
  IST: "Europe/Istanbul",
  SAW: "Europe/Istanbul",
  AYT: "Europe/Istanbul",
  // Europe
  FRA: "Europe/Berlin",
  MUC: "Europe/Berlin",
  BER: "Europe/Berlin",
  DUS: "Europe/Berlin",
  HAM: "Europe/Berlin",
  CDG: "Europe/Paris",
  ORY: "Europe/Paris",
  NCE: "Europe/Paris",
  LYS: "Europe/Paris",
  AMS: "Europe/Amsterdam",
  MAD: "Europe/Madrid",
  BCN: "Europe/Madrid",
  PMI: "Europe/Madrid",
  AGP: "Europe/Madrid",
  FCO: "Europe/Rome",
  MXP: "Europe/Rome",
  VCE: "Europe/Rome",
  NAP: "Europe/Rome",
  LIS: "Europe/Lisbon",
  OPO: "Europe/Lisbon",
  ZRH: "Europe/Zurich",
  GVA: "Europe/Zurich",
  VIE: "Europe/Vienna",
  BRU: "Europe/Brussels",
  DUB: "Europe/Dublin",
  CPH: "Europe/Copenhagen",
  ARN: "Europe/Stockholm",
  OSL: "Europe/Oslo",
  HEL: "Europe/Helsinki",
  ATH: "Europe/Athens",
  PRG: "Europe/Prague",
  WAW: "Europe/Warsaw",
  KRK: "Europe/Warsaw",
  BUD: "Europe/Budapest",
  KEF: "Atlantic/Reykjavik",
  ZAG: "Europe/Zagreb",
  DBV: "Europe/Zagreb",
  SPU: "Europe/Zagreb",
  OTP: "Europe/Bucharest",
  SOF: "Europe/Sofia",
  BEG: "Europe/Belgrade",
  SVO: "Europe/Moscow",
  DME: "Europe/Moscow",
  LED: "Europe/Moscow",
  // Americas
  YYZ: "America/Toronto",
  YUL: "America/Toronto",
  YVR: "America/Vancouver",
  YYC: "America/Edmonton",
  MEX: "America/Mexico_City",
  GDL: "America/Mexico_City",
  CUN: "America/Cancun",
  GRU: "America/Sao_Paulo",
  GIG: "America/Sao_Paulo",
  EZE: "America/Argentina/Buenos_Aires",
  SCL: "America/Santiago",
  BOG: "America/Bogota",
  LIM: "America/Lima",
  // Africa
  JNB: "Africa/Johannesburg",
  CPT: "Africa/Johannesburg",
  CAI: "Africa/Cairo",
  CMN: "Africa/Casablanca",
  NBO: "Africa/Nairobi",
  ADD: "Africa/Addis_Ababa",
}

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/
const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i

/** Offset of `timeZone` from UTC at `instantMs`, in milliseconds. */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instantMs))
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  )
  return asUtc - Math.floor(instantMs / 1000) * 1000
}

/**
 * The instant a wall-clock time at `iata` names, e.g. "2025-06-01T23:40" at
 * SIN is 15:40Z. A string that already carries an offset is taken as written.
 * Returns null when the airport's zone is unknown or the time unparseable,
 * because a guessed zone yields a confidently wrong instant.
 */
export function airportLocalTime(value: string, iata: string): Date | null {
  const text = value.trim()
  if (!text) return null
  if (HAS_OFFSET.test(text)) {
    const d = new Date(text)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const zone = AIRPORT_TIMEZONES[iata.toUpperCase()]
  const m = WALL_CLOCK.exec(text)
  if (!zone || !m) return null
  const [, y, mo, d, h, mi, s] = m
  const wall = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0))
  // The offset at the first guess can differ from the offset at the answer
  // when a daylight-saving change falls between them, so re-read it there.
  const offset = zoneOffsetMs(wall - zoneOffsetMs(wall, zone), zone)
  const candidate = wall - offset
  // A wall time in a spring-forward gap never appears on the clock; its
  // offset does not round-trip. Read it with the pre-jump offset, which lands
  // on the instant after the jump (02:30 EST-that-never-was is 03:30 EDT).
  const actual = zoneOffsetMs(candidate, zone)
  return new Date(actual === offset ? candidate : wall - actual)
}
