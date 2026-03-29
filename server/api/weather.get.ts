import { z } from "zod";

const querySchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  startDate: z.string().date(),
  endDate: z.string().date(),
});

interface DayForecast {
  date: string;
  tempMax: number;
  tempMin: number;
  weatherCode: number;
}

const _getWeather = defineCachedFunction(
  async (_event: unknown, lat: number, lng: number, startDate: string, endDate: string): Promise<DayForecast[]> => {
    const response = await $fetch<{
      daily: {
        time: string[];
        temperature_2m_max: number[];
        temperature_2m_min: number[];
        weather_code: number[];
      };
    }>("https://api.open-meteo.com/v1/forecast", {
      params: {
        latitude: lat,
        longitude: lng,
        daily: "temperature_2m_max,temperature_2m_min,weather_code",
        start_date: startDate,
        end_date: endDate,
        timezone: "auto",
      },
    });

    return response.daily.time.map((date, i) => ({
      date,
      tempMax: Math.round(response.daily.temperature_2m_max[i] ?? 0),
      tempMin: Math.round(response.daily.temperature_2m_min[i] ?? 0),
      weatherCode: response.daily.weather_code[i] ?? 0,
    }));
  },
  {
    maxAge: 60 * 60 * 6, // 6 hours — weather updates regularly
    name: "weather",
    getKey: (_event: unknown, lat: number, lng: number, startDate: string, endDate: string) =>
      `${lat.toFixed(1)},${lng.toFixed(1)},${startDate},${endDate}`,
  }
);

export default defineEventHandler(async (event) => {
  await requireAuth(event);
  const query = await getValidatedQuery(event, querySchema.parse);
  const forecasts = await _getWeather(null, query.lat, query.lng, query.startDate, query.endDate);
  return forecasts;
});
