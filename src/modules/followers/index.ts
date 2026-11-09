// Followers of a request (SPEC 2026-11-08-atendimento-dia-a-dia, part D): the rules (SF-211).
export {
  MAX_COLLEAGUE_FOLLOWERS,
  assertCanRemoveFollower,
  autoFollowsOnComment,
  followerEventTitle,
  planAddFollower,
  readsAsFollower,
} from "./domain/follower";
export type { CurrentFollower, FollowKind, FollowedRequest, FollowerPerson, FollowerRole } from "./domain/follower";
