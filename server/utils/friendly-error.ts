import { createError } from "h3"

/**
 * Turns a validation failure into an error a human can read.
 *
 * `getValidatedRouterParams(event, schema.parse)` throws a raw ZodError. Nitro
 * serialises that into the 400 body, so `err.data.message` becomes the
 * stringified issue array — and any page that renders the server's message shows
 * the user something like:
 *
 *   [ { "origin": "string", "code": "invalid_format", "expected": "uuid", ... } ]
 *
 * That is what the invite page was displaying under the heading "Invite Error".
 * It is both unreadable and a needless disclosure of internal validation shape.
 *
 * Use on routes whose params come straight from a URL a person may have
 * truncated or mistyped — shared links and invite links especially.
 */
export function friendlyParamError(_cause: unknown, message: string) {
  return createError({
    statusCode: 400,
    statusMessage: "Bad Request",
    message,
    // Deliberately no `data`: that is the field Nitro echoes to the client and
    // the one that carried the Zod issues.
  })
}

/**
 * Parse router params, converting any validation failure into `message`.
 * Mirrors `getValidatedRouterParams(event, schema.parse)` on success.
 */
export function parseParamsOrFail<T>(
  params: unknown,
  parse: (input: unknown) => T,
  message: string,
): T {
  try {
    return parse(params)
  } catch (cause) {
    throw friendlyParamError(cause, message)
  }
}
