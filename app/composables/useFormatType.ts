/**
 * Formats a snake_case or lowercase type string to Title Case.
 * e.g., "tourist_attraction" → "Tourist Attraction"
 *       "scenic_spot" → "Scenic Spot"
 *       "cafe" → "Cafe"
 */
export function formatType(type: string): string {
  return type
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
