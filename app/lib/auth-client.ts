import { createAuthClient } from "better-auth/vue";
// import { sentinelClient } from "@better-auth/infra/client";

export const authClient = createAuthClient({
  // https://github.com/better-auth/better-auth/issues/8332
  // plugins: [sentinelClient()],
});
