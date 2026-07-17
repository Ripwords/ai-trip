/**
 * Incremental Server-Sent Events frame parser.
 *
 * The network delivers arbitrary byte chunks, so one SSE frame routinely
 * arrives split mid-JSON across two reads. Callers keep a buffer, hand it here,
 * and feed the returned `rest` back in as the prefix of the next read — only
 * complete frames are ever emitted.
 *
 * NOTE: JSON payloads may themselves contain an escaped "\n\n"; that is safe
 * because JSON.stringify escapes real newlines to the two characters \ and n,
 * so they can never look like a frame boundary.
 */

export interface SseFrame {
  event: string
  data: string
}

export function parseSseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  // Normalize CRLF so the boundary scan only has to consider "\n\n".
  let rest = buffer.replace(/\r\n/g, "\n")
  const frames: SseFrame[] = []

  for (;;) {
    const idx = rest.indexOf("\n\n")
    if (idx === -1) break

    const raw = rest.slice(0, idx)
    rest = rest.slice(idx + 2)

    let event = "message"
    const dataLines: string[] = []
    for (const line of raw.split("\n")) {
      if (line.startsWith(":")) continue // comment / heartbeat
      if (line.startsWith("event:")) {
        event = line.slice(6).trim()
      } else if (line.startsWith("data:")) {
        // A single leading space after the colon is part of the framing.
        dataLines.push(line.slice(5).replace(/^ /, ""))
      }
    }

    if (dataLines.length > 0) frames.push({ event, data: dataLines.join("\n") })
  }

  return { frames, rest }
}
