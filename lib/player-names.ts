import type { getDb } from "../db";
import { players } from "../db/schema";
import { normalizePlayerName } from "./domain";

type RedCourtDb = ReturnType<typeof getDb>;

/**
 * Includes legacy rows whose normalized_name has not been backfilled because
 * they conflicted with another old record.
 */
export async function findPlayerNameConflict(
  db: RedCourtDb,
  name: string,
  excludePlayerId?: string,
): Promise<{ id: string; name: string } | undefined> {
  const normalized = normalizePlayerName(name);
  const existing = await db.select({ id: players.id, name: players.name }).from(players);
  return existing.find((player) =>
    player.id !== excludePlayerId && normalizePlayerName(player.name) === normalized,
  );
}

export function hasDuplicateIncomingPlayerNames(playersToCheck: Array<{ name: string }>): boolean {
  const names = playersToCheck.map((player) => normalizePlayerName(player.name));
  return new Set(names).size !== names.length;
}
