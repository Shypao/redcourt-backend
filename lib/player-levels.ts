export const PLAYER_LEVELS = ["A", "B", "C", "D", "E"] as const;

export type PlayerLevel = (typeof PLAYER_LEVELS)[number];

export const PLAYER_LEVEL_DETAILS: Record<PlayerLevel, { label: string; color: string }> = {
  A: { label: "Advanced", color: "Red" },
  B: { label: "Upper intermediate", color: "Orange" },
  C: { label: "Intermediate", color: "Blue" },
  D: { label: "Beginner", color: "Green" },
  E: { label: "New player", color: "Pink" },
};

export function normalizePlayerLevel(value: unknown): PlayerLevel {
  const level = typeof value === "string" ? value.trim().toUpperCase() : "";
  return PLAYER_LEVELS.includes(level as PlayerLevel) ? level as PlayerLevel : "C";
}

export function playerLevelClass(level: unknown) {
  return `level-${normalizePlayerLevel(level).toLowerCase()}`;
}
