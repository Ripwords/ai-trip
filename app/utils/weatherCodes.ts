interface WeatherInfo {
  label: string
  icon: string
}

const WMO_CODES: Record<number, WeatherInfo> = {
  0: { label: "Clear sky", icon: "lucide:sun" },
  1: { label: "Mainly clear", icon: "lucide:sun" },
  2: { label: "Partly cloudy", icon: "lucide:cloud-sun" },
  3: { label: "Overcast", icon: "lucide:cloud" },
  45: { label: "Foggy", icon: "lucide:cloud-fog" },
  48: { label: "Icy fog", icon: "lucide:cloud-fog" },
  51: { label: "Light drizzle", icon: "lucide:cloud-drizzle" },
  53: { label: "Drizzle", icon: "lucide:cloud-drizzle" },
  55: { label: "Heavy drizzle", icon: "lucide:cloud-drizzle" },
  61: { label: "Light rain", icon: "lucide:cloud-rain" },
  63: { label: "Rain", icon: "lucide:cloud-rain" },
  65: { label: "Heavy rain", icon: "lucide:cloud-rain" },
  71: { label: "Light snow", icon: "lucide:cloud-snow" },
  73: { label: "Snow", icon: "lucide:cloud-snow" },
  75: { label: "Heavy snow", icon: "lucide:cloud-snow" },
  80: { label: "Rain showers", icon: "lucide:cloud-rain-wind" },
  81: { label: "Rain showers", icon: "lucide:cloud-rain-wind" },
  82: { label: "Violent showers", icon: "lucide:cloud-rain-wind" },
  95: { label: "Thunderstorm", icon: "lucide:cloud-lightning" },
  96: { label: "Thunderstorm + hail", icon: "lucide:cloud-lightning" },
  99: { label: "Thunderstorm + hail", icon: "lucide:cloud-lightning" },
}

export function getWeatherInfo(code: number): WeatherInfo {
  return WMO_CODES[code] ?? { label: "Unknown", icon: "lucide:cloud" }
}
