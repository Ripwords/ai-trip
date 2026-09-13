import { createAuthClient } from "better-auth/vue"
import { dashClient, sentinelClient } from "@better-auth/infra/client"
import { adminClient } from "better-auth/client/plugins"

export const authClient = createAuthClient({
  plugins: [
    dashClient(),
    adminClient(),
    sentinelClient({
      identifyUrl: process.env.BETTER_AUTH_IDENTIFY_URL,
    }),
  ],
})
