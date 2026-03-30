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

interface WeatherResponse {
  forecasts: DayForecast[];
  isHistorical: boolean;
}

const _getWeather = defineCachedFunction(
  async (_event: unknown, lat: number, lng: number, startDate: string, endDate: string): Promise<WeatherResponse> => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const maxForecast = new Date(today);
    maxForecast.setDate(maxForecast.getDate() + 16);

    const tripStart = new Date(startDate + "T00:00:00");
    const tripEnd = new Date(endDate + "T00:00:00");

    // Use forecast API if any dates are within the 16-day window
    if (tripStart <= maxForecast && tripEnd >= today) {
      const clampedStart = tripStart < today ? today.toISOString().slice(0, 10) : startDate;
      const clampedEnd = tripEnd > maxForecast ? maxForecast.toISOString().slice(0, 10) : endDate;

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
          start_date: clampedStart,
          end_date: clampedEnd,
          timezone: "auto",
        },
      });

      return {
        forecasts: response.daily.time.map((date, i) => ({
          date,
          tempMax: Math.round(response.daily.temperature_2m_max[i] ?? 0),
          tempMin: Math.round(response.daily.temperature_2m_min[i] ?? 0),
          weatherCode: response.daily.weather_code[i] ?? 0,
        })),
        isHistorical: false,
      };
    }

    // Fallback: historical data from last year for the same date range
    const lastYearStart = shiftDateByYear(startDate, -1);
    const lastYearEnd = shiftDateByYear(endDate, -1);

    const response = await $fetch<{
      daily: {
        time: string[];
        temperature_2m_max: number[];
        temperature_2m_min: number[];
        weather_code: number[];
      };
    }>("https://archive-api.open-meteo.com/v1/archive", {
      params: {
        latitude: lat,
        longitude: lng,
        daily: "temperature_2m_max,temperature_2m_min,weather_code",
        start_date: lastYearStart,
        end_date: lastYearEnd,
        timezone: "auto",
      },
    });

    // Map historical dates back to the original trip dates
    return {
      forecasts: response.daily.time.map((historicalDate, i) => ({
        date: shiftDateByYear(historicalDate, 1),
        tempMax: Math.round(response.daily.temperature_2m_max[i] ?? 0),
        tempMin: Math.round(response.daily.temperature_2m_min[i] ?? 0),
        weatherCode: response.daily.weather_code[i] ?? 0,
      })),
      isHistorical: true,
    };
  },
  {
    maxAge: 60 * 60 * 6,
    name: "weather",
    getKey: (_event: unknown, lat: number, lng: number, startDate: string, endDate: string) =>
      `${lat.toFixed(1)},${lng.toFixed(1)},${startDate},${endDate}`,
  }
);

function shiftDateByYear(dateStr: string, years: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

export default defineEventHandler(async (event) => {
  await requireAuth(event);
  const query = await getValidatedQuery(event, querySchema.parse);
  return _getWeather(null, query.lat, query.lng, query.startDate, query.endDate);
});
