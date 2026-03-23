import { createAuthClient } from "better-auth/vue";
import { sentinelClient } from "@better-auth/infra/client";

export const authClient = createAuthClient({
  plugins: [sentinelClient()],
});
