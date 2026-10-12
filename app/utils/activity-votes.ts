export type Vote = "up" | "down"

/** What `GET .../votes` returns for one activity. */
export interface VoteState {
  upVotes: number
  downVotes: number
  myVote: Vote | null
}

export const NO_VOTES: VoteState = { upVotes: 0, downVotes: 0, myVote: null }

/** Voting and comments only mean something once someone else is on the trip. */
export function isCollaborativeTrip(activeMembers: readonly unknown[] | null | undefined): boolean {
  return (activeMembers?.length ?? 0) > 1
}

/**
 * The counts after `POST .../vote` answered with the reader's vote as it now
 * stands (null when the same vote toggled it off).
 */
export function applyVoteResult(state: VoteState, next: Vote | null): VoteState {
  let { upVotes, downVotes } = state
  if (state.myVote === "up") upVotes = Math.max(upVotes - 1, 0)
  if (state.myVote === "down") downVotes = Math.max(downVotes - 1, 0)
  if (next === "up") upVotes++
  if (next === "down") downVotes++
  return { upVotes, downVotes, myVote: next }
}
