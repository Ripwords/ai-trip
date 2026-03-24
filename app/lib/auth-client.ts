import { createAuthClient } from "better-auth/vue";
import { sentinelClient, dashClient } from "@better-auth/infra/client";

export const authClient = createAuthClient({
  plugins: [sentinelClient(), dashClient()],
});
