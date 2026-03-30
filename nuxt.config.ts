import tailwindcss from "@tailwindcss/vite";

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  app: {
    head: {
      meta: [
        { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1" },
        { name: "description", content: "AI-powered travel itinerary planner with real places verified by Google Maps" },
        { name: "theme-color", content: "#e85d3a" },
      ],
      link: [
        { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
        { rel: "apple-touch-icon", href: "/apple-touch-icon-180x180.png" },
      ],
      script: [
        {
          // Prevent flash of wrong theme — runs before any rendering
          innerHTML: `(function(){try{var m=localStorage.getItem('theme-mode');if(m==='dark'||(m!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark')}catch(e){}})()`,
          type: "text/javascript",
        },
      ],
    },
  },
  compatibilityDate: "2025-07-15",
  future: {
    compatibilityVersion: 5,
  },
  experimental: {
    nitroAutoImports: true,
  },
  css: ["./app/assets/css/tailwind.css"],
  devtools: { enabled: true },
  modules: ["@nuxt/icon", "@nuxt/image", "nuxt-security", "dayjs-nuxt", "@vite-pwa/nuxt"],
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: [
        'better-auth/vue',
        'better-auth/vue',
        '@vue/devtools-core',
        '@vue/devtools-kit',
        '@googlemaps/js-api-loader',
        'dayjs', // CJS
        'dayjs/plugin/updateLocale', // CJS
        'dayjs/plugin/relativeTime', // CJS
        'dayjs/plugin/utc', // CJS
        '@better-auth/infra/client',
        'vuedraggable', // CJS
        'sortablejs',
        'better-auth/client/plugins',
        '@googlemaps/markerclusterer',
      ],
    },
  },
  runtimeConfig: {
    public: {
      betterAuthUrl: "",
      googleMapsApiKey: "",
    },
  },

  // PWA Configuration
  pwa: {
    registerType: "autoUpdate",
    manifest: {
      name: "AI Trip — Travel Planner",
      short_name: "AI Trip",
      description: "AI-powered travel itinerary planner with real places verified by Google Maps",
      theme_color: "#e85d3a",
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
      navigateFallback: "/",
      globPatterns: ["**/*.{js,css,html,png,svg,ico,woff2}"],
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
    headers: {
      crossOriginEmbedderPolicy: "unsafe-none",
      contentSecurityPolicy: {
        "default-src": ["'self'"],
        "script-src": [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
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

  routeRules: {
    "/api/places/search": {
      security: {
        rateLimiter: { tokensPerInterval: 60, interval: 60000 },
      },
    },
    "/api/places/*/details": {
      security: {
        rateLimiter: { tokensPerInterval: 30, interval: 60000 },
      },
    },
    "/api/auth/**": {
      security: {
        rateLimiter: { tokensPerInterval: 30, interval: 60000 },
      },
    },
  },
});
