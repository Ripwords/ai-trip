import tailwindcss from "@tailwindcss/vite";

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  app: {
    head: {
      link: [
        { rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
        { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
        { rel: "icon", type: "image/png", sizes: "512x512", href: "/image.png" },
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
  modules: ["@nuxt/icon", "@nuxt/image", "nuxt-security", "dayjs-nuxt"],
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: [
        'better-auth/vue',
        '@vue/devtools-core',
        '@vue/devtools-kit',
        '@googlemaps/js-api-loader',
      ],
    },
  },
  runtimeConfig: {
    public: {
      betterAuthUrl: "",
      googleMapsApiKey: "",
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
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": [
          "'self'",
          "data:",
          "https:",
          "https://*.googleapis.com",
          "https://*.gstatic.com",
        ],
        "connect-src": [
          "'self'",
          "https://maps.googleapis.com",
          "https://places.googleapis.com",
        ],
        "frame-src": ["https://maps.googleapis.com"],
      },
    },
    rateLimiter: {
      tokensPerInterval: 100,
      interval: 60000,
      headers: true,
    },
  },

  routeRules: {
    // Stricter rate limit for AI generation (expensive)
    "/api/trips/*/generate": {
      security: {
        rateLimiter: {
          tokensPerInterval: 3,
          interval: 60000,
        },
      },
    },
    // Stricter rate limit for place search (costs money)
    "/api/places/search": {
      security: {
        rateLimiter: {
          tokensPerInterval: 20,
          interval: 60000,
        },
      },
    },
    // Auth routes
    "/api/auth/**": {
      security: {
        rateLimiter: {
          tokensPerInterval: 10,
          interval: 60000,
        },
      },
    },
  },
});
