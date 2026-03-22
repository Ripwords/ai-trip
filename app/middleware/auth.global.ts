import { authClient } from "../lib/auth-client";

const PROTECTED_ROUTES = ["/dashboard", "/trips"];

export default defineNuxtRouteMiddleware(async (to) => {
  if (!PROTECTED_ROUTES.some((r) => to.path.startsWith(r))) return;

  const { data: session } = await authClient.useSession(useFetch);
  const isAuthenticated = !!session.value?.user;

  if (!isAuthenticated) {
    return navigateTo("/login");
  }
});
