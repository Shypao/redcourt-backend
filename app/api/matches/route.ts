import { getDb, ensureTables } from "../../../db";
import { courts, matchPlayers, matches, players } from "../../../db/schema";
import { desc, gt, sql } from "drizzle-orm";
import { getChatGPTUser, requireApiStaff } from "../../chatgpt-auth";
import { currentDayCutoff } from "../../../lib/day-session";
import { duplicatePlayerNameMessage, isPlayerNameUniqueConstraintError, normalizePlayerName } from "../../../lib/domain";
import { findPlayerNameConflict, hasDuplicateIncomingPlayerNames } from "../../../lib/player-names";
import {
  calculatePlayerCharges,
  isShuttlecockId,
  SHUTTLECOCKS,
  shuttlecockTotalPriceCentavos,
} from "../../../lib/shuttlecocks";

type PlayerCost = {
  playerId: string;
  playerName: string;
  costCentavos: number;
};

function parseJsonArray<T>(value: string): T[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  const denied = await requireApiStaff();
  if (denied) return denied;
  await ensureTables();
  const db = getDb();
  // Optional ?limit= lets callers (like the Recent Daily History panel) pull
  // more than the default 50 rows so several days' worth group correctly;
  // capped to keep the query bounded.
  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 500) : 50;
  const requestedOffset = Number(url.searchParams.get("offset"));
  const offset = Number.isInteger(requestedOffset) && requestedOffset > 0 ? requestedOffset : 0;
  const cutoff = url.searchParams.get("scope") === "current_day" ? await currentDayCutoff(db) : 0;
  const rows = await db.select().from(matches).where(cutoff ? gt(matches.endedAt, cutoff) : undefined).orderBy(desc(matches.endedAt)).limit(limit).offset(offset);
  return Response.json(
    rows.map((row) => ({
      ...row,
      winnerName: row.winnerName ? normalizePlayerName(row.winnerName) : null,
      playerNames: parseJsonArray<string>(row.playerNames).map((name) => normalizePlayerName(name)),
      playerCosts: parseJsonArray<PlayerCost>(row.playerCosts).map((cost) => ({ ...cost, playerName: normalizePlayerName(cost.playerName) })),
      queueOrder: parseJsonArray<string>(row.queueOrder).map((name) => normalizePlayerName(name)),
      billingSummary: parseJsonArray<Record<string, unknown>>(row.billingSummary).map((billing) => ({ ...billing, ...(typeof billing.playerName === "string" ? { playerName: normalizePlayerName(billing.playerName) } : {}) })),
    })),
  );
}

type IncomingPlayer = { id: string; name: string };

export async function POST(request: Request) {
  const denied = await requireApiStaff();
  if (denied) return denied;
  await ensureTables();

  const body = (await request.json()) as {
    courtId: number;
    players: IncomingPlayer[];
    shuttlecockId?: unknown;
    startedAt?: number;
    endedAt?: number;
  };

  if (!Array.isArray(body.players) || body.players.length < 2 || body.players.length > 4) {
    return Response.json({ error: "Expected 2 to 4 players" }, { status: 400 });
  }
  if (
    !Number.isInteger(body.courtId) ||
    body.courtId < 1 ||
    body.courtId > 9 ||
    new Set(body.players.map((player) => player.id)).size !== body.players.length ||
    body.players.some(
      (player) =>
        typeof player.id !== "string" ||
        !player.id ||
        typeof player.name !== "string" ||
        !player.name.trim(),
    )
  ) {
    return Response.json({ error: "Invalid court or player data" }, { status: 400 });
  }
  if (!isShuttlecockId(body.shuttlecockId)) {
    return Response.json({ error: "Select a valid shuttlecock" }, { status: 400 });
  }

  const db = getDb();
  const normalizedPlayers = body.players.map((player) => ({ ...player, name: normalizePlayerName(player.name) }));
  if (hasDuplicateIncomingPlayerNames(normalizedPlayers)) return Response.json({ error: "Players must have unique names" }, { status: 400 });
  for (const player of normalizedPlayers) {
    if (await findPlayerNameConflict(db, player.name, player.id)) return Response.json({ error: duplicatePlayerNameMessage(player.name) }, { status: 409 });
  }
  const endedAt = body.endedAt ?? Date.now();
  const startedAt = body.startedAt ?? endedAt;
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || startedAt > endedAt) {
    return Response.json({ error: "Invalid match duration" }, { status: 400 });
  }

  const shuttlecock = SHUTTLECOCKS[body.shuttlecockId];
  const shuttlecockTotal = shuttlecockTotalPriceCentavos(shuttlecock.id, body.players.length);
  const charges = calculatePlayerCharges(
    shuttlecockTotal,
    body.players.length,
  );
  const playerCosts: PlayerCost[] = normalizedPlayers.map((player, index) => ({
    playerId: player.id,
    playerName: player.name,
    costCentavos: charges[index],
  }));
  const matchId = crypto.randomUUID();
  const [court] = await db.select({ name: courts.name, number: courts.number }).from(courts).where(sql`${courts.id} = ${body.courtId}`).limit(1);
  const user = await getChatGPTUser();

  const insertMatch = db.insert(matches).values({
    id: matchId,
    courtId: body.courtId,
    playerNames: JSON.stringify(playerCosts.map((player) => player.playerName)),
    startedAt,
    endedAt,
    shuttlecockName: shuttlecock.name,
    shuttlecockPriceCentavos: shuttlecockTotal,
    costPerPlayerCentavos: charges[0] ?? 0,
    playerCosts: JSON.stringify(playerCosts),
    status: "completed",
    courtName: court?.name ?? `Court ${court?.number ?? body.courtId}`,
    queueOrder: JSON.stringify(playerCosts.map((player) => player.playerName)),
    managedBy: user?.displayName ?? null,
  });

  const insertMatchPlayers = playerCosts.map((player) => db.insert(matchPlayers).values({
    matchId,
    playerId: player.playerId,
    playerName: player.playerName,
    costCentavos: player.costCentavos,
  }));

  const updatePlayers = normalizedPlayers.map((player, index) =>
    db
      .insert(players)
      .values({
        id: player.id,
        name: player.name,
        normalizedName: player.name,
        timesPlayed: 1,
        totalBillCentavos: charges[index],
        createdAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: players.id,
        set: {
          timesPlayed: sql`${players.timesPlayed} + 1`,
          totalBillCentavos: sql`${players.totalBillCentavos} + ${charges[index]}`,
          name: player.name,
          normalizedName: player.name,
        },
      }),
  );

  try {
    await db.batch(
      [insertMatch, ...insertMatchPlayers, ...updatePlayers] as [
      typeof insertMatch,
      ...(typeof insertMatchPlayers[number] | typeof updatePlayers[number])[],
      ],
    );
  } catch (error) {
    if (isPlayerNameUniqueConstraintError(error)) return Response.json({ error: "A player with that name was added by another staff member. Refresh and try again." }, { status: 409 });
    throw error;
  }

  return Response.json({
    ok: true,
    matchId,
    shuttlecockName: shuttlecock.name,
    shuttlecockPriceCentavos: shuttlecockTotal,
    playerCosts,
  });
}
