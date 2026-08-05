import tailwindcss from "@tailwindcss/vite"

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  site: {
    url: process.env.NUXT_PUBLIC_BETTER_AUTH_URL || "",
    name: "AI Trip",
    description: "AI-powered travel itinerary planner with real places verified by Google Maps",
    defaultLocale: "en",
  },

  app: {
    head: {
      htmlAttrs: { lang: "en" },
      meta: [
        {
          name: "viewport",
          content:
            "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
        },
        { name: "apple-mobile-web-app-capable", content: "yes" },
        { name: "mobile-web-app-capable", content: "yes" },
        { name: "apple-mobile-web-app-title", content: "AI Trip" },
      ],
      link: [
        { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
        { rel: "apple-touch-icon", href: "/apple-touch-icon-180x180.png" },
      ],
      script: [],
    },
  },
  compatibilityDate: "2025-07-15",
  future: {
    compatibilityVersion: 5,
  },
  experimental: {
    nitroAutoImports: true,
  },
  nitro: {
    experimental: {
      tasks: true,
    },
    scheduledTasks: {
      // Import visa requirements dataset every 6 months (Jan 1 and Jul 1 at 3am)
      "0 3 1 1,7 *": "import-visa-data",
      // Check passport expiry reminders daily at 9am
      "0 9 * * *": "check-passport-expiry",
    },
    // Persist `defineCachedFunction` results across serverless invocations.
    // Without this, Nitro defaults to in-memory storage and every Vercel
    // cold start re-pays Google Places. Activates only when the Upstash
    // env vars are present (Vercel Marketplace > Upstash KV provisions them).
    ...(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
      ? {
          storage: {
            cache: {
              driver: "upstash",
              url: process.env.KV_REST_API_URL,
              token: process.env.KV_REST_API_TOKEN,
            },
          },
        }
      : {}),
    externals: {
      inline: [/^@mastra\//],
      external: ["@neondatabase/serverless", "pg", "better-sqlite3", "@resvg/resvg-js", "sharp"],
      traceOptions: {
        ignore: [
          "**/node_modules/drizzle-kit/**",
          "**/node_modules/typescript/**",
          "**/node_modules/oxlint/**",
          "**/node_modules/oxfmt/**",
          "**/node_modules/@oxlint/**",
          "**/node_modules/@oxfmt/**",
          "**/node_modules/@rolldown/**",
          "**/node_modules/@stencil/**",
          "**/node_modules/prettier/**",
          "**/node_modules/@esbuild/**",
          "**/node_modules/fb-dotslash/**",
          "**/node_modules/jiti/**",
          "**/node_modules/rollup/**",
          "**/node_modules/vite/**",
          "**/node_modules/terser/**",
          "**/node_modules/nitropack/**",
          "**/node_modules/@vite-pwa/**",
        ],
      },
    },
  },
  css: ["~/assets/css/tailwind.css"],
  devtools: { enabled: process.env.NODE_ENV !== "production" },
  modules: [
    "@tresjs/nuxt",
    "@nuxt/icon",
    "@nuxt/image",
    "nuxt-security",
    "dayjs-nuxt",
    "@vite-pwa/nuxt",
    "@nuxtjs/seo",
    "@vercel/analytics",
  ],
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: [
        "three",
        "better-auth/vue",
        "@vue/devtools-core",
        "@vue/devtools-kit",
        "@googlemaps/js-api-loader",
        "dayjs", // CJS
        "dayjs/plugin/updateLocale", // CJS
        "dayjs/plugin/relativeTime", // CJS
        "dayjs/plugin/utc", // CJS
        "@better-auth/infra/client",
        "vuedraggable", // CJS
        "sortablejs",
        "better-auth/client/plugins",
        "@googlemaps/markerclusterer",
        "@unhead/schema-org/vue",
        "d3-geo",
        "topojson-client",
        "@tresjs/cientos",
        "three/examples/jsm/loaders/FBXLoader.js",
        "vue-border-beam",
        "marked",
        "dompurify",
      ],
    },
  },
  runtimeConfig: {
    public: {
      betterAuthUrl: "",
      googleMapsApiKey: "",
    },
    privateGoogleMapsApiKey: "",
  },

  // PWA Configuration
  pwa: {
    registerType: "autoUpdate",
    // TEMPORARY kill-switch: ships a service worker that unregisters itself and
    // clears all caches on every client, to recover browsers stranded on a
    // stale cached worker (broken CSS / stale JS). Remove to re-enable the PWA
    // once clients have recovered.
    selfDestroying: true,
    pwaAssets: {
      config: true,
      includeHtmlHeadLinks: true,
      overrideManifestIcons: true,
    },
    manifest: {
      name: "AI Trip — Travel Planner",
      short_name: "AI Trip",
      description: "AI-powered travel itinerary planner with real places verified by Google Maps",
      theme_color: "#faf8f5",
      background_color: "#faf8f5",
      display: "standalone",
      orientation: "portrait",
      start_url: "/dashboard",
      scope: "/",
      icons: [
        {
          src: "pwa-64x64.png",
          sizes: "64x64",
          type: "image/png",
        },
        {
          src: "pwa-192x192.png",
          sizes: "192x192",
          type: "image/png",
        },
        {
          src: "pwa-512x512.png",
          sizes: "512x512",
          type: "image/png",
        },
        {
          src: "maskable-icon-512x512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
    },
    workbox: {
      // No navigateFallback — this is an SSR app, not SPA.
      // Navigation requests should go to the server for proper auth redirects.
      navigateFallback: null,
      globPatterns: ["**/*.{js,css,png,svg,ico,woff2}"],
      globIgnores: ["**/apple-splash-*.png"],
      runtimeCaching: [
        {
          urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
          handler: "CacheFirst",
          options: {
            cacheName: "google-fonts-css",
            expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
        {
          urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
          handler: "CacheFirst",
          options: {
            cacheName: "google-fonts-webfonts",
            expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
      ],
    },
    client: {
      installPrompt: true,
      periodicSyncForUpdates: 3600, // check for updates every hour
    },
    devOptions: {
      enabled: false, // enable for PWA testing in dev
    },
  },

  security: {
    nonce: true,
    headers: {
      strictTransportSecurity: {
        maxAge: 31536000,
        includeSubdomains: true,
        preload: true,
      },
      crossOriginEmbedderPolicy: "unsafe-none",
      contentSecurityPolicy: {
        "default-src": ["'self'"],
        "script-src": [
          "'self'",
          "'strict-dynamic'",
          "'nonce-{{nonce}}'",
          "https://maps.googleapis.com",
        ],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "img-src": [
          "'self'",
          "data:",
          "https:",
          "https://*.googleapis.com",
          "https://*.gstatic.com",
          "https://*.googleusercontent.com",
        ],
        "connect-src": [
          "'self'",
          "https://maps.googleapis.com",
          "https://places.googleapis.com",
          "https://fonts.googleapis.com",
          "https://accounts.google.com",
          "https://*.public.blob.vercel-storage.com",
        ],
        "frame-src": ["https://maps.googleapis.com", "https://accounts.google.com"],
      },
    },
    rateLimiter: {
      tokensPerInterval: 300,
      interval: 60000,
      headers: true,
    },
  },

  // Robots configuration
  robots: {
    disallow: ["/dashboard", "/settings", "/trips", "/invite", "/explore", "/api"],
    blockAiBots: true,
  },

  // Sitemap configuration
  sitemap: {
    exclude: ["/dashboard/**", "/settings/**", "/trips/**", "/invite/**", "/explore/**", "/api/**"],
    cacheMaxAgeSeconds: 600,
  },

  // Schema.org structured data
  schemaOrg: {
    identity: {
      type: "Organization",
      name: "AI Trip",
      logo: "/image.png",
    },
  },

  // OG Image defaults
  ogImage: {
    defaults: {
      width: 1200,
      height: 630,
    },
  },

  routeRules: {
    // Landing page is static marketing content. `isr: 600` caches it at the
    // edge for 10 minutes; do NOT use `isr: true` — on Vercel that cache
    // survives deploys indefinitely, so a single bad render (e.g. an upstream
    // error page captured into the payload) would be served to every visitor
    // forever. Authenticated visitors get redirected to /dashboard by the
    // client-side auth middleware after hydration.
    "/": { isr: 600 },
    "/api/places/search": {
      security: {
        rateLimiter: { tokensPerInterval: 60, interval: 60000 },
      },
    },
    "/api/auth/**": {
      security: {
        rateLimiter: { tokensPerInterval: 30, interval: 60000 },
        xssValidator: false,
      },
    },
    "/api/visa/**": {
      security: {
        rateLimiter: { tokensPerInterval: 120, interval: 60000 },
      },
    },
    "/api/ai/layover-tips": {
      security: {
        rateLimiter: { tokensPerInterval: 10, interval: 60000 },
      },
    },
    // Per-route burst limit on the expensive Gemini-backed endpoints. The
    // monthly application-level credit (tryConsumeAiCredit) caps total usage,
    // but it can't stop a malicious user from firing 100 parallel requests
    // inside one second and bypassing the global 300/min — this does.
    "/api/trips/*/discuss": {
      security: {
        rateLimiter: { tokensPerInterval: 5, interval: 60000 },
      },
    },
    "/api/trips/*/days/*/ai": {
      security: {
        rateLimiter: { tokensPerInterval: 5, interval: 60000 },
      },
    },
    // The deep (AI judgment) review runs a DeepSeek agent loop with Places and
    // Distance Matrix tools attached, so it belongs with the other model-calling
    // endpoints rather than under the global 300/min. The plain deterministic
    // review shares this route and the panel re-fires it on every day switch,
    // which is why the budget is 20 rather than the 5 `discuss` gets. The AI
    // branch is additionally capped by the monthly credit.
    "/api/trips/*/review": {
      security: {
        rateLimiter: { tokensPerInterval: 20, interval: 60000 },
      },
    },
    // Receipt uploads (#48) are the only endpoint that accepts megabytes at a
    // time. The per-expense count and the 5 MB size limit bound one request;
    // this bounds how fast they can arrive.
    "/api/trips/*/expenses/*/attachments": {
      security: {
        rateLimiter: { tokensPerInterval: 20, interval: 60000 },
      },
    },
    // Starting a run can spend an outline credit and calls Gemini, so it gets
    // the same burst limit as the other model-backed endpoints. The free GET
    // shares it: a tab polls this at most once per generate press.
    "/api/trips/*/generation-run": {
      security: {
        rateLimiter: { tokensPerInterval: 10, interval: 60000 },
      },
    },
    "/api/trips/*/members/invite": {
      security: {
        rateLimiter: { tokensPerInterval: 10, interval: 60000 },
      },
    },
    "/api/trips": {
      security: {
        rateLimiter: { tokensPerInterval: 20, interval: 60000 },
      },
    },
    "/api/flights": {
      security: {
        rateLimiter: { tokensPerInterval: 30, interval: 60000 },
      },
    },
    "/api/visited-countries/**": {
      security: {
        rateLimiter: { tokensPerInterval: 60, interval: 60000 },
      },
    },
  },
})
