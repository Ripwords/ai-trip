export interface TripActivity {
  id: string
  name: string
  type: string
  description: string | null
  lat: number | null
  lng: number | null
  address: string | null
  rating: string | null
  suggestedTime: string | null
  estimatedDurationMinutes: number | null
  costEstimate: string | null
  notes: string | null
  actualCost: string | null
  photos: string[] | null
  openingHours: string[] | null
  tags: string[] | null
  placeId: string | null
  sortOrder: number
}

export interface TripTravelSegment {
  fromActivityId: string
  toActivityId?: string | null
  durationSeconds?: number | null
  distanceMeters?: number | null
  mode?: "driving" | "walking" | "transit" | "bicycling"
  durationText: string | null
  distanceText: string | null
}

export interface TripDay {
  id: string
  dayNumber: number
  date: string
  notes: string | null
  accommodationName: string | null
  accommodationAddress: string | null
  accommodationLat: number | null
  accommodationLng: number | null
  accommodationPlaceId: string | null
  activities: TripActivity[]
  travelSegments: TripTravelSegment[]
}

export interface TripResponse {
  id: string
  destination: string
  startDate: string
  endDate: string
  status: string
  budget: string | null
  currencyCode: string
  tripNotes: string | null
  shareToken: string | null
  preferences: {
    budget?: string
    pace?: string
    interests?: string[]
    travelStyle?: string[]
    transportMode?: "driving" | "walking" | "transit" | "bicycling"
  } | null
  days: TripDay[]
  _role: string
}
