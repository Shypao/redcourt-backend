import { normalizePlayerLevel } from "./player-levels.ts";

export type MatchingMode = "match_level" | "mixed_level" | "mens" | "womens" | "mixed_doubles" | "random";
export type MatchablePlayer = { id: string; level: unknown; gender: string; joinedAt: number };

const LEVELS = 5;
const score = (level: unknown) => "ABCDE".indexOf(normalizePlayerLevel(level));
const oldest = <T extends MatchablePlayer>(rows: T[]) => [...rows].sort((a, b) => a.joinedAt - b.joinedAt);

function compareCandidateAge<T extends MatchablePlayer>(left: T[], right: T[]) {
  const leftTimes = left.map((player) => player.joinedAt).sort((a, b) => a - b);
  const rightTimes = right.map((player) => player.joinedAt).sort((a, b) => a - b);
  for (let index = 0; index < Math.min(leftTimes.length, rightTimes.length); index += 1) {
    if (leftTimes[index] !== rightTimes[index]) return leftTimes[index] - rightTimes[index];
  }
  return 0;
}

function removeGroup<T extends MatchablePlayer>(pool: T[], group: T[]) {
  const selected = new Set(group.map((player) => player.id));
  return pool.filter((player) => !selected.has(player.id));
}

// A balanced level group is either four players at the same level or two
// players at each of two adjacent levels: A/B, B/C, C/D, or D/E.
function levelBalancedCandidates<T extends MatchablePlayer>(pool: T[]) {
  const candidates: T[][] = [];
  for (let level = 0; level < LEVELS; level += 1) {
    const same = oldest(pool.filter((player) => score(player.level) === level));
    if (same.length >= 4) candidates.push(same.slice(0, 4));
    if (level === LEVELS - 1) continue;
    const lower = same;
    const upper = oldest(pool.filter((player) => score(player.level) === level + 1));
    if (lower.length >= 2 && upper.length >= 2) candidates.push([...lower.slice(0, 2), ...upper.slice(0, 2)]);
  }
  return candidates;
}

function arrangeLevelBalancedTeams<T extends MatchablePlayer>(group: T[]) {
  const sorted = [...group].sort((a, b) => score(a.level) - score(b.level) || a.joinedAt - b.joinedAt);
  if (score(sorted[0].level) === score(sorted[3].level)) return sorted;
  // Team 1 and Team 2 each receive one lower- and one upper-level player.
  return [sorted[0], sorted[3], sorted[1], sorted[2]];
}

function createLevelBalancedGroups<T extends MatchablePlayer>(players: T[]) {
  const groups: T[][] = [];
  let pool = oldest(players);
  while (pool.length >= 4) {
    const candidate = levelBalancedCandidates(pool).sort(compareCandidateAge)[0];
    if (!candidate) break;
    groups.push(arrangeLevelBalancedTeams(candidate));
    pool = removeGroup(pool, candidate);
  }
  return groups;
}

function mixedDoublesCandidates<T extends MatchablePlayer>(pool: T[]) {
  const candidates: T[][] = [];
  for (let level = 0; level < LEVELS; level += 1) {
    const sameMen = oldest(pool.filter((player) => player.gender === "male" && score(player.level) === level));
    const sameWomen = oldest(pool.filter((player) => player.gender === "female" && score(player.level) === level));
    if (sameMen.length >= 2 && sameWomen.length >= 2) candidates.push([...sameMen.slice(0, 2), ...sameWomen.slice(0, 2)]);
    if (level === LEVELS - 1) continue;

    const lowerMen = sameMen;
    const lowerWomen = sameWomen;
    const upperMen = oldest(pool.filter((player) => player.gender === "male" && score(player.level) === level + 1));
    const upperWomen = oldest(pool.filter((player) => player.gender === "female" && score(player.level) === level + 1));
    // Select two players from each adjacent level and exactly two of each gender.
    for (let lowerMaleCount = 0; lowerMaleCount <= 2; lowerMaleCount += 1) {
      const lowerFemaleCount = 2 - lowerMaleCount;
      const upperMaleCount = 2 - lowerMaleCount;
      const upperFemaleCount = lowerMaleCount;
      if (lowerMen.length < lowerMaleCount || lowerWomen.length < lowerFemaleCount || upperMen.length < upperMaleCount || upperWomen.length < upperFemaleCount) continue;
      candidates.push([
        ...lowerMen.slice(0, lowerMaleCount),
        ...lowerWomen.slice(0, lowerFemaleCount),
        ...upperMen.slice(0, upperMaleCount),
        ...upperWomen.slice(0, upperFemaleCount),
      ]);
    }
  }
  return candidates;
}

function arrangeMixedDoublesTeams<T extends MatchablePlayer>(group: T[]) {
  const men = oldest(group.filter((player) => player.gender === "male"));
  const women = oldest(group.filter((player) => player.gender === "female"));
  const lineups = [
    [men[0], women[0], men[1], women[1]],
    [men[0], women[1], men[1], women[0]],
  ];
  return lineups.sort((left, right) => {
    const leftDifference = Math.abs(score(left[0].level) + score(left[1].level) - score(left[2].level) - score(left[3].level));
    const rightDifference = Math.abs(score(right[0].level) + score(right[1].level) - score(right[2].level) - score(right[3].level));
    return leftDifference - rightDifference;
  })[0];
}

function createMixedDoublesGroups<T extends MatchablePlayer>(players: T[]) {
  const groups: T[][] = [];
  let pool = oldest(players.filter((player) => player.gender === "male" || player.gender === "female"));
  while (pool.length >= 4) {
    const candidate = mixedDoublesCandidates(pool).sort(compareCandidateAge)[0];
    if (!candidate) break;
    groups.push(arrangeMixedDoublesTeams(candidate));
    pool = removeGroup(pool, candidate);
  }
  return groups;
}

export function createStandbyGroups<T extends MatchablePlayer>(players: T[], mode: MatchingMode): T[][] {
  const waiting = oldest(players);
  if (mode === "random") {
    const groups: T[][] = [];
    const shuffled = [...waiting].sort(() => Math.random() - 0.5);
    while (shuffled.length >= 4) groups.push(shuffled.splice(0, 4));
    return groups;
  }
  if (mode === "mixed_doubles") return createMixedDoublesGroups(waiting);
  if (mode === "mens" || mode === "womens") {
    const gender = mode === "mens" ? "male" : "female";
    return createLevelBalancedGroups(waiting.filter((player) => player.gender === gender));
  }
  if (mode === "match_level") return createLevelBalancedGroups(waiting);

  const groups: T[][] = [];
  const sorted = [...waiting].sort((a, b) => score(a.level) - score(b.level) || a.joinedAt - b.joinedAt);
  while (sorted.length >= 4) {
    const first = sorted.shift()!;
    const last = sorted.pop()!;
    const middle = sorted.splice(Math.max(0, Math.floor(sorted.length / 2) - 1), 2);
    groups.push(arrangeLevelBalancedTeams([first, ...middle, last]));
  }
  return groups;
}
