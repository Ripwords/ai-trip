import { createAuthClient } from "better-auth/vue";
import { dashClient } from "@better-auth/infra/client";
import { adminClient } from "better-auth/client/plugins"

export const authClient = createAuthClient({
  plugins: [dashClient(), adminClient()],
});
