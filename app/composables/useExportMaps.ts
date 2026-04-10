interface ExportActivity {
  name: string
  lat: number | null
  lng: number | null
  address: string | null
  placeId?: string | null
  description?: string | null
  type?: string
  suggestedTime?: string | null
}

interface ExportDay {
  dayNumber: number
  date: string
  activities: ExportActivity[]
}

/**
 * Generate a Google Maps directions URL for a day's activities.
 * Max 9 waypoints on desktop, 3 on mobile.
 */
export function getGoogleMapsDirectionsUrl(activities: ExportActivity[]): string | null {
  const geoActivities = activities.filter((a) => a.lat != null && a.lng != null)
  if (geoActivities.length < 2) return null

  const origin = `${geoActivities[0]!.lat},${geoActivities[0]!.lng}`
  const destination = `${geoActivities[geoActivities.length - 1]!.lat},${geoActivities[geoActivities.length - 1]!.lng}`

  // Waypoints are everything between first and last (max 9)
  const waypoints = geoActivities
    .slice(1, -1)
    .slice(0, 9)
    .map((a) => `${a.lat},${a.lng}`)
    .join("|")

  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=transit`
  if (waypoints) {
    url += `&waypoints=${waypoints}`
  }

  return url
}

/**
 * Generate a KML file string for the entire trip.
 */
export function generateKml(tripName: string, days: ExportDay[]): string {
  const placemarks = days.flatMap((day) =>
    day.activities
      .filter((a) => a.lat != null && a.lng != null)
      .map((a) => {
        const time = a.suggestedTime ? ` (${a.suggestedTime})` : ""
        const desc = a.description || ""
        return `    <Placemark>
      <name>${escapeXml(a.name)}</name>
      <description>${escapeXml(`Day ${day.dayNumber} - ${day.date}${time}\n${desc}`)}</description>
      <Point>
        <coordinates>${a.lng},${a.lat},0</coordinates>
      </Point>
    </Placemark>`
      }),
  )

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(tripName)}</name>
${placemarks.join("\n")}
  </Document>
</kml>`
}

/**
 * Download a KML file.
 */
export function downloadKml(tripName: string, days: ExportDay[]) {
  const kml = generateKml(tripName, days)
  const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${tripName.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}-itinerary.kml`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}
