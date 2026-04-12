/**
 * Airport coordinates for the ~200 busiest airports, matching iata-to-country.ts coverage.
 * Coordinates are real airport coordinates (not city centers), suitable for 3D globe visualization.
 */
export const airportCoordinates: Record<string, { lat: number; lng: number }> = {
  // United States
  ATL: { lat: 33.6407, lng: -84.4277 },
  LAX: { lat: 33.9425, lng: -118.4081 },
  ORD: { lat: 41.9742, lng: -87.9073 },
  DFW: { lat: 32.8998, lng: -97.0403 },
  DEN: { lat: 39.8561, lng: -104.6737 },
  JFK: { lat: 40.6413, lng: -73.7781 },
  SFO: { lat: 37.6213, lng: -122.379 },
  SEA: { lat: 47.4502, lng: -122.3088 },
  LAS: { lat: 36.084, lng: -115.1537 },
  MCO: { lat: 28.4312, lng: -81.308 },
  EWR: { lat: 40.6925, lng: -74.1687 },
  MIA: { lat: 25.7959, lng: -80.287 },
  IAH: { lat: 29.9902, lng: -95.3368 },
  BOS: { lat: 42.3656, lng: -71.0096 },
  MSP: { lat: 44.882, lng: -93.2218 },
  DTW: { lat: 42.2162, lng: -83.3554 },
  PHL: { lat: 39.8721, lng: -75.2411 },
  CLT: { lat: 35.214, lng: -80.9431 },
  IAD: { lat: 38.9531, lng: -77.4565 },
  SAN: { lat: 32.7338, lng: -117.1933 },
  HNL: { lat: 21.3245, lng: -157.9251 },
  // United Kingdom
  LHR: { lat: 51.477, lng: -0.4613 },
  LGW: { lat: 51.1537, lng: -0.1821 },
  STN: { lat: 51.885, lng: 0.235 },
  MAN: { lat: 53.3537, lng: -2.275 },
  EDI: { lat: 55.9508, lng: -3.3725 },
  // Japan
  NRT: { lat: 35.7647, lng: 140.3864 },
  HND: { lat: 35.5494, lng: 139.7798 },
  KIX: { lat: 34.4347, lng: 135.232 },
  CTS: { lat: 42.7752, lng: 141.6922 },
  FUK: { lat: 33.5859, lng: 130.4511 },
  NGO: { lat: 34.8583, lng: 136.8054 },
  // China
  PEK: { lat: 40.0799, lng: 116.6031 },
  PVG: { lat: 31.1443, lng: 121.8083 },
  CAN: { lat: 23.3924, lng: 113.299 },
  CTU: { lat: 30.5785, lng: 103.947 },
  SZX: { lat: 22.6393, lng: 113.8108 },
  HKG: { lat: 22.308, lng: 113.9185 },
  // South Korea
  ICN: { lat: 37.4602, lng: 126.4407 },
  GMP: { lat: 37.5583, lng: 126.7906 },
  PUS: { lat: 35.1795, lng: 128.9382 },
  // Singapore
  SIN: { lat: 1.3644, lng: 103.9915 },
  // Thailand
  BKK: { lat: 13.6811, lng: 100.7476 },
  DMK: { lat: 13.9126, lng: 100.6067 },
  CNX: { lat: 18.7669, lng: 98.9626 },
  HKT: { lat: 8.1132, lng: 98.3169 },
  // Malaysia
  KUL: { lat: 2.7456, lng: 101.7099 },
  PEN: { lat: 5.2977, lng: 100.2768 },
  BKI: { lat: 5.9421, lng: 116.0501 },
  KCH: { lat: 1.4847, lng: 110.3458 },
  LGK: { lat: 6.3297, lng: 99.7287 },
  SZB: { lat: 3.1306, lng: 101.5493 },
  // Indonesia
  CGK: { lat: -6.1256, lng: 106.6559 },
  DPS: { lat: -8.7482, lng: 115.1672 },
  SUB: { lat: -7.3798, lng: 112.787 },
  // Vietnam
  SGN: { lat: 10.8188, lng: 106.6519 },
  HAN: { lat: 21.2212, lng: 105.8072 },
  DAD: { lat: 16.0439, lng: 108.1992 },
  // Philippines
  MNL: { lat: 14.5086, lng: 121.0197 },
  CEB: { lat: 10.3075, lng: 123.979 },
  // India
  DEL: { lat: 28.5562, lng: 77.1 },
  BOM: { lat: 19.0896, lng: 72.8656 },
  BLR: { lat: 13.1979, lng: 77.7063 },
  MAA: { lat: 12.9941, lng: 80.1709 },
  CCU: { lat: 22.6547, lng: 88.4467 },
  HYD: { lat: 17.2313, lng: 78.4298 },
  // Australia
  SYD: { lat: -33.9399, lng: 151.1753 },
  MEL: { lat: -37.669, lng: 144.841 },
  BNE: { lat: -27.3842, lng: 153.1175 },
  PER: { lat: -31.9403, lng: 115.9669 },
  // New Zealand
  AKL: { lat: -37.0082, lng: 174.785 },
  CHC: { lat: -43.4894, lng: 172.5322 },
  WLG: { lat: -41.3272, lng: 174.8051 },
  // UAE
  DXB: { lat: 25.2532, lng: 55.3657 },
  AUH: { lat: 24.433, lng: 54.6511 },
  SHJ: { lat: 25.3286, lng: 55.5172 },
  // Turkey
  IST: { lat: 41.2753, lng: 28.7519 },
  SAW: { lat: 40.8985, lng: 29.3092 },
  AYT: { lat: 36.8987, lng: 30.8005 },
  // Germany
  FRA: { lat: 50.0379, lng: 8.5622 },
  MUC: { lat: 48.3538, lng: 11.7861 },
  BER: { lat: 52.3667, lng: 13.5033 },
  DUS: { lat: 51.2895, lng: 6.7668 },
  HAM: { lat: 53.6304, lng: 9.9882 },
  // France
  CDG: { lat: 49.0097, lng: 2.5479 },
  ORY: { lat: 48.7233, lng: 2.3794 },
  NCE: { lat: 43.6584, lng: 7.2159 },
  LYS: { lat: 45.7256, lng: 5.0811 },
  // Netherlands
  AMS: { lat: 52.3086, lng: 4.7639 },
  // Spain
  MAD: { lat: 40.4936, lng: -3.5668 },
  BCN: { lat: 41.2971, lng: 2.0785 },
  PMI: { lat: 39.5517, lng: 2.7388 },
  AGP: { lat: 36.6749, lng: -4.499 },
  // Italy
  FCO: { lat: 41.8003, lng: 12.2389 },
  MXP: { lat: 45.6301, lng: 8.7231 },
  VCE: { lat: 45.5053, lng: 12.3519 },
  NAP: { lat: 40.886, lng: 14.2908 },
  // Portugal
  LIS: { lat: 38.7813, lng: -9.1359 },
  OPO: { lat: 41.2481, lng: -8.6814 },
  // Switzerland
  ZRH: { lat: 47.4647, lng: 8.5492 },
  GVA: { lat: 46.2381, lng: 6.1089 },
  // Austria
  VIE: { lat: 48.1103, lng: 16.5697 },
  // Belgium
  BRU: { lat: 50.9014, lng: 4.4844 },
  // Ireland
  DUB: { lat: 53.4213, lng: -6.2701 },
  // Denmark
  CPH: { lat: 55.618, lng: 12.6561 },
  // Sweden
  ARN: { lat: 59.6519, lng: 17.9186 },
  // Norway
  OSL: { lat: 60.1939, lng: 11.1004 },
  // Finland
  HEL: { lat: 60.3172, lng: 24.9633 },
  // Greece
  ATH: { lat: 37.9364, lng: 23.9445 },
  // Czech Republic
  PRG: { lat: 50.1008, lng: 14.26 },
  // Poland
  WAW: { lat: 52.1657, lng: 20.9671 },
  KRK: { lat: 50.0777, lng: 19.7848 },
  // Hungary
  BUD: { lat: 47.4298, lng: 19.2611 },
  // Canada
  YYZ: { lat: 43.6772, lng: -79.6306 },
  YVR: { lat: 49.1967, lng: -123.1815 },
  YUL: { lat: 45.4706, lng: -73.7408 },
  YYC: { lat: 51.1315, lng: -114.0106 },
  // Mexico
  MEX: { lat: 19.4363, lng: -99.0721 },
  CUN: { lat: 21.0365, lng: -86.8771 },
  GDL: { lat: 20.5218, lng: -103.3111 },
  // Brazil
  GRU: { lat: -23.4356, lng: -46.4731 },
  GIG: { lat: -22.8099, lng: -43.2505 },
  // Argentina
  EZE: { lat: -34.8222, lng: -58.5358 },
  // Chile
  SCL: { lat: -33.3928, lng: -70.7856 },
  // Colombia
  BOG: { lat: 4.7016, lng: -74.1469 },
  // Peru
  LIM: { lat: -12.0219, lng: -77.1143 },
  // South Africa
  JNB: { lat: -26.1392, lng: 28.246 },
  CPT: { lat: -33.9649, lng: 18.6017 },
  // Egypt
  CAI: { lat: 30.1219, lng: 31.4056 },
  // Morocco
  CMN: { lat: 33.3675, lng: -7.5897 },
  // Kenya
  NBO: { lat: -1.3192, lng: 36.9275 },
  // Ethiopia
  ADD: { lat: 8.9779, lng: 38.7993 },
  // Qatar
  DOH: { lat: 25.2731, lng: 51.6081 },
  // Saudi Arabia
  RUH: { lat: 24.9576, lng: 46.6988 },
  JED: { lat: 21.6796, lng: 39.1565 },
  // Israel
  TLV: { lat: 32.0114, lng: 34.8867 },
  // Russia
  SVO: { lat: 55.9736, lng: 37.4125 },
  DME: { lat: 55.4088, lng: 37.9063 },
  LED: { lat: 59.8003, lng: 30.2625 },
  // Taiwan
  TPE: { lat: 25.0777, lng: 121.2325 },
  TSA: { lat: 25.0692, lng: 121.5526 },
  // Cambodia
  PNH: { lat: 11.5466, lng: 104.844 },
  REP: { lat: 13.4107, lng: 103.8129 },
  // Myanmar
  RGN: { lat: 16.9073, lng: 96.1332 },
  // Sri Lanka
  CMB: { lat: 7.1808, lng: 79.8841 },
  // Maldives
  MLE: { lat: 4.1918, lng: 73.529 },
  // Nepal
  KTM: { lat: 27.6966, lng: 85.3591 },
  // Bangladesh
  DAC: { lat: 23.8433, lng: 90.3978 },
  // Pakistan
  ISB: { lat: 33.6167, lng: 73.0997 },
  KHI: { lat: 24.9065, lng: 67.1608 },
  LHE: { lat: 31.5216, lng: 74.4036 },
  // Fiji
  NAN: { lat: -17.7554, lng: 177.4431 },
  // Iceland
  KEF: { lat: 63.985, lng: -22.6056 },
  // Croatia
  ZAG: { lat: 45.7429, lng: 16.0688 },
  DBV: { lat: 42.5614, lng: 18.2682 },
  SPU: { lat: 43.5389, lng: 16.298 },
  // Romania
  OTP: { lat: 44.5711, lng: 26.085 },
  // Bulgaria
  SOF: { lat: 42.6967, lng: 23.4114 },
  // Serbia
  BEG: { lat: 44.8184, lng: 20.309 },
  // Laos
  VTE: { lat: 17.9883, lng: 102.5633 },
  LPQ: { lat: 19.8973, lng: 102.1608 },
}

/** Get coordinates for an IATA airport code */
export function getAirportCoordinates(iata: string): { lat: number; lng: number } | undefined {
  return airportCoordinates[iata.toUpperCase()]
}
