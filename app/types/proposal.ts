// The UI-side Proposal mirror now lives in shared/ (imported by both the SSE
// wire contract and the client). Re-exported here so existing `~/types/proposal`
// importers keep working and there is exactly one mirror to maintain.
export type { Proposal } from "#shared/utils/discuss-sse"
