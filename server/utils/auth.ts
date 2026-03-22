import type { H3Event } from "h3";
import { auth } from "../lib/auth";

export async function requireAuth(event: H3Event) {
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session) {
    throw createError({ statusCode: 401, message: "Unauthorized" });
  }

  return session;
}
