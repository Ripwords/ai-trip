import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { NO_VOTES, applyVoteResult, isCollaborativeTrip } from "./activity-votes"

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")

const day = read("../components/DaySection.vue")
const card = read("../components/ActivityCard.vue")

describe("isCollaborativeTrip (D2)", () => {
  it("needs more than one active member", () => {
    assert.equal(isCollaborativeTrip(undefined), false)
    assert.equal(isCollaborativeTrip([]), false)
    assert.equal(isCollaborativeTrip([{ userId: "owner" }]), false)
    assert.equal(isCollaborativeTrip([{ userId: "owner" }, { userId: "friend" }]), true)
  })
})

describe("applyVoteResult (D2)", () => {
  it("adds a first vote", () => {
    assert.deepEqual(applyVoteResult(NO_VOTES, "up"), { upVotes: 1, downVotes: 0, myVote: "up" })
  })

  it("takes a vote back when the server toggled it off", () => {
    assert.deepEqual(applyVoteResult({ upVotes: 3, downVotes: 1, myVote: "up" }, null), {
      upVotes: 2,
      downVotes: 1,
      myVote: null,
    })
  })

  it("moves a vote from one side to the other", () => {
    assert.deepEqual(applyVoteResult({ upVotes: 3, downVotes: 1, myVote: "down" }, "up"), {
      upVotes: 4,
      downVotes: 0,
      myVote: "up",
    })
  })

  it("never counts below zero", () => {
    assert.deepEqual(applyVoteResult({ upVotes: 0, downVotes: 0, myVote: "up" }, null), {
      upVotes: 0,
      downVotes: 0,
      myVote: null,
    })
  })
})

describe("DaySection wires voting and comments (D2)", () => {
  it("tells each card whether the trip is a group trip", () => {
    assert.ok(/isCollaborativeTrip\(/.test(day), "collaboration is never detected")
    assert.ok(/:is-collaborative="isCollaborative"/.test(day), "cards never get isCollaborative")
  })

  it("handles votes and comment toggles from the card", () => {
    assert.ok(/@vote="handleVote"/.test(day), "votes are dropped")
    assert.ok(/@show-comments="toggleComments"/.test(day), "comment clicks are dropped")
    assert.ok(/\/vote`/.test(day) && /\/votes`/.test(day), "vote endpoints are not called")
    assert.ok(/<ActivityComments/.test(day), "no comment thread is rendered")
  })

  it("reports a failed vote", () => {
    const at = day.indexOf("async function handleVote")
    assert.ok(at > 0, "handleVote missing")
    assert.ok(/toast\.error\(/.test(day.slice(at, at + 900)), "a failed vote is silent")
  })

  it("shows the reader's own vote as pressed", () => {
    assert.ok(/:aria-pressed="votes\?\.myVote === 'up'"/.test(card), "up vote has no pressed state")
    assert.ok(
      /:aria-pressed="votes\?\.myVote === 'down'"/.test(card),
      "down vote has no pressed state",
    )
  })
})
