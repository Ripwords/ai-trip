# ---- Install ----
FROM oven/bun:1 AS install
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ---- Build ----
FROM oven/bun:1 AS build
WORKDIR /app
COPY --from=install /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
RUN bun run build

# ---- Migrate ----
# Pass DATABASE_URL_UNPOOLED at runtime for Neon direct connection
FROM oven/bun:1 AS migrate
WORKDIR /app
COPY --from=build /app/server/db/migrations ./server/db/migrations
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/package.json ./package.json
RUN bun add drizzle-kit drizzle-orm pg @neondatabase/serverless
CMD ["bunx", "drizzle-kit", "migrate"]

# ---- Release ----
FROM oven/bun:1 AS release
WORKDIR /app
COPY --from=build /app/.output ./.output
ENV NODE_ENV=production
USER bun
EXPOSE 3000
CMD ["bun", "run", ".output/server/index.mjs"]
