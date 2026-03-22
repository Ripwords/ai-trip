import { setOptions, importLibrary } from "@googlemaps/js-api-loader";

let initialized = false;

export function useGoogleMaps() {
  const config = useRuntimeConfig();
  const isLoaded = ref(false);

  function ensureInitialized() {
    if (!initialized) {
      setOptions({ key: config.public.googleMapsApiKey as string, v: "weekly" });
      initialized = true;
    }
  }

  async function loadMaps() {
    ensureInitialized();
    const lib = await importLibrary("maps");
    isLoaded.value = true;
    return lib;
  }

  async function loadMarker() {
    ensureInitialized();
    return await importLibrary("marker");
  }

  return { isLoaded, loadMaps, loadMarker };
}
