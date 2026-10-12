import {
  combinePresetAndAppleSplashScreens,
  defineConfig,
  minimal2023Preset,
} from "@vite-pwa/assets-generator/config"

export default defineConfig({
  headLinkOptions: { preset: "2023" },
  preset: combinePresetAndAppleSplashScreens(minimal2023Preset, {
    padding: 0.3,
    resizeOptions: { background: "#f8f9fa", fit: "contain" },
    darkResizeOptions: { background: "#1f2023", fit: "contain" },
    linkMediaOptions: {
      log: true,
      addMediaScreen: true,
      basePath: "/",
      xhtml: false,
    },
    png: { compressionLevel: 9, quality: 60 },
  }),
  images: ["public/image.png"],
})
