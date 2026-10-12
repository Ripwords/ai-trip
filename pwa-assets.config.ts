import {
  combinePresetAndAppleSplashScreens,
  defineConfig,
  minimal2023Preset,
} from "@vite-pwa/assets-generator/config"

export default defineConfig({
  headLinkOptions: { preset: "2023" },
  preset: combinePresetAndAppleSplashScreens(minimal2023Preset, {
    padding: 0.3,
    resizeOptions: { background: "#f4f7f7", fit: "contain" },
    darkResizeOptions: { background: "#172023", fit: "contain" },
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
