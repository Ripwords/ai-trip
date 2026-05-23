/**
 * Maps ICAO airline designators (3 letters, used by Flighty and ATC) to IATA
 * codes (2 chars, used by booking systems and airline logo services). Covers
 * the most common commercial carriers; unknown codes pass through unchanged.
 *
 * Mirrored on the client in app/utils/icao-to-iata.ts — keep the two tables in
 * sync.
 */
export const ICAO_TO_IATA: Record<string, string> = {
  AAL: "AA", // American Airlines
  ACA: "AC", // Air Canada
  AAR: "OZ", // Asiana Airlines
  AFL: "SU", // Aeroflot
  AFR: "AF", // Air France
  AIC: "AI", // Air India
  ANA: "NH", // All Nippon Airways
  ANZ: "NZ", // Air New Zealand
  AAY: "G4", // Allegiant Air
  AMX: "AM", // Aeroméxico
  AWE: "US", // US Airways (legacy)
  AXM: "AK", // AirAsia Malaysia
  AZA: "AZ", // Alitalia (legacy)
  ITY: "AZ", // ITA Airways
  AZU: "AD", // Azul
  BAW: "BA", // British Airways
  BWA: "BW", // Caribbean Airlines
  BTI: "BT", // airBaltic
  CAL: "CI", // China Airlines
  CCA: "CA", // Air China
  CES: "MU", // China Eastern
  CSN: "CZ", // China Southern
  CKK: "CK", // China Cargo
  CPA: "CX", // Cathay Pacific
  CSZ: "C8", // Cargolux Italia
  CLX: "CV", // Cargolux
  DAL: "DL", // Delta
  DLH: "LH", // Lufthansa
  EIN: "EI", // Aer Lingus
  ELY: "LY", // El Al
  ETD: "EY", // Etihad
  ETH: "ET", // Ethiopian
  EVA: "BR", // EVA Air
  EZY: "U2", // easyJet
  FDX: "FX", // FedEx
  FFT: "F9", // Frontier
  FIN: "AY", // Finnair
  GIA: "GA", // Garuda Indonesia
  HAL: "HA", // Hawaiian
  HVN: "VN", // Vietnam Airlines
  IBE: "IB", // Iberia
  JAL: "JL", // Japan Airlines
  JBU: "B6", // JetBlue
  JST: "JQ", // Jetstar
  KAL: "KE", // Korean Air
  KLM: "KL", // KLM
  LAN: "LA", // LATAM
  LOT: "LO", // LOT Polish
  MAS: "MH", // Malaysia Airlines
  NAX: "DY", // Norwegian
  NCA: "KZ", // Nippon Cargo
  OAL: "OA", // Olympic Air
  PAL: "PR", // Philippine Airlines
  QFA: "QF", // Qantas
  QTR: "QR", // Qatar Airways
  RAM: "AT", // Royal Air Maroc
  RJA: "RJ", // Royal Jordanian
  RYR: "FR", // Ryanair
  SAS: "SK", // SAS
  SIA: "SQ", // Singapore Airlines
  SVA: "SV", // Saudia
  SWA: "WN", // Southwest
  SWR: "LX", // SWISS
  TAM: "JJ", // TAM (legacy LATAM Brazil)
  TAP: "TP", // TAP Portugal
  THA: "TG", // Thai Airways
  THY: "TK", // Turkish Airlines
  TGW: "TR", // Scoot
  TVF: "TO", // Transavia France
  UAE: "EK", // Emirates
  UAL: "UA", // United
  UPS: "5X", // UPS Airlines
  VIR: "VS", // Virgin Atlantic
  VLG: "VY", // Vueling
  VOZ: "VA", // Virgin Australia
  WJA: "WS", // WestJet
}

/**
 * Returns the IATA code for a given airline designator. If the input is already
 * an IATA code (2 chars) or an unknown ICAO code, it is returned uppercased
 * with whitespace trimmed.
 */
export function toIata(code: string): string {
  const normalized = code.trim().toUpperCase()
  if (normalized.length === 3 && normalized in ICAO_TO_IATA) {
    return ICAO_TO_IATA[normalized]!
  }
  return normalized
}
