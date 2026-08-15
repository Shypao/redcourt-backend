import { getDb, ensureTables } from "../../../db";
import { activeGamePlayers, activityLogs, gameBillings, matchPlayers, matches, players, queueEntries, reservations } from "../../../db/schema";
import { and, count, desc, eq, gte, like, lt, or, sql } from "drizzle-orm";
import { cleanText, duplicatePlayerNameMessage, integerParam, isPlayerNameUniqueConstraintError, normalizePlayerName } from "../../../lib/domain";
import { findPlayerNameConflict } from "../../../lib/player-names";
import { manilaMonthRange } from "../../../lib/time";
import { normalizePlayerLevel } from "../../../lib/player-levels";
import { requireApiStaff } from "../../chatgpt-auth";

export async function GET(request: Request) {
  const denied = await requireApiStaff();
  if (denied) return denied;
  await ensureTables();
  const db = getDb();
  const url = new URL(request.url);
  const id = cleanText(url.searchParams.get("id"), 80);
  if (id) {
    const [player] = await db.select().from(players).where(eq(players.id, id)).limit(1);
    const [archivedPlayer] = player ? [] : await db.select({ id: matchPlayers.playerId, name: matchPlayers.playerName, level: matchPlayers.playerLevel, gender: matchPlayers.playerGender }).from(matchPlayers).innerJoin(matches, eq(matchPlayers.matchId, matches.id)).where(eq(matchPlayers.playerId, id)).orderBy(desc(matches.endedAt)).limit(1);
    if (!player && !archivedPlayer) return Response.json({ error: "Player not found" }, { status: 404 });
    const identity = player ?? { ...archivedPlayer, contact: null, notes: null, timesPlayed: 0, totalBillCentavos: 0, createdAt: 0, updatedAt: null };
    const year = integerParam(url.searchParams.get("year"));
    const month = integerParam(url.searchParams.get("month"));
    const historyFilters = [eq(matchPlayers.playerId, id), eq(matches.status, "completed")];
    if (year && month && month >= 1 && month <= 12) {
      const [start, end] = manilaMonthRange(year, month);
      historyFilters.push(gte(matches.endedAt, start), lt(matches.endedAt, end));
    }
    const [history, reservationHistory, billingHistory] = await Promise.all([
      db.select({ id: matches.id, endedAt: matches.endedAt, startedAt: matches.startedAt, courtId: matches.courtId, shuttlecockName: matches.shuttlecockName, costCentavos: matchPlayers.costCentavos }).from(matchPlayers).innerJoin(matches, eq(matchPlayers.matchId, matches.id)).where(and(...historyFilters)).orderBy(desc(matches.endedAt)).limit(200),
      db.select().from(reservations).where(eq(reservations.customerPlayerId, id)).orderBy(desc(reservations.startsAt)).limit(100),
      db.select().from(gameBillings).where(eq(gameBillings.playerId, id)).orderBy(desc(gameBillings.updatedAt)).limit(200),
    ]);
    const periodTotal = history.reduce((sum, game) => sum + game.costCentavos, 0);
    return Response.json({ ...identity, name: normalizePlayerName(identity.name), gamesPlayed: history.length, totalBillCentavos: periodTotal, averageCostPerGameCentavos: history.length ? Math.round(periodTotal / history.length) : 0, history, reservationHistory: reservationHistory.map((row) => ({ ...row, customerName: normalizePlayerName(row.customerName) })), billingHistory: billingHistory.map((row) => ({ ...row, playerName: normalizePlayerName(row.playerName), additionalCharges: JSON.parse(row.additionalCharges || "[]") })), periodSummary: { gamesPlayed: history.length, totalBillCentavos: periodTotal, averageCostPerGameCentavos: history.length ? Math.round(periodTotal / history.length) : 0 } });
  }
  if (url.searchParams.get("scope") === "history") {
    const limit = Math.min(integerParam(url.searchParams.get("limit")) ?? 200, 500);
    const archived = await db.select({ id: matchPlayers.playerId, name: matchPlayers.playerName, level: matchPlayers.playerLevel, gender: matchPlayers.playerGender, gamesPlayed: count(), totalBillCentavos: sql<number>`coalesce(sum(${matchPlayers.costCentavos}), 0)` }).from(matchPlayers).innerJoin(matches, eq(matchPlayers.matchId, matches.id)).where(eq(matches.status, "completed")).groupBy(matchPlayers.playerId, matchPlayers.playerName, matchPlayers.playerLevel, matchPlayers.playerGender).orderBy(desc(count()), matchPlayers.playerName).limit(limit);
    return Response.json(archived.map((player) => ({ ...player, name: normalizePlayerName(player.name), averageCostPerGameCentavos: player.gamesPlayed ? Math.round(player.totalBillCentavos / player.gamesPlayed) : 0 })));
  }
  const query = cleanText(url.searchParams.get("q"), 80).toLowerCase();
  const filter = query ? or(like(players.name, `%${query}%`), like(players.id, `%${query}%`), like(players.contact, `%${query}%`)) : undefined;
  const limit = Math.min(integerParam(url.searchParams.get("limit")) ?? 100, 200);
  const rows = await db.select().from(players).where(filter).orderBy(desc(players.timesPlayed), players.name).limit(limit);
  return Response.json(
    rows.map((player) => ({
      ...player,
      name: normalizePlayerName(player.name),
      gamesPlayed: player.timesPlayed,
      averageCostPerGameCentavos:
        player.timesPlayed > 0
          ? Math.round(player.totalBillCentavos / player.timesPlayed)
          : 0,
    })),
  );
}

export async function POST(request: Request) {
  const denied = await requireApiStaff();
  if (denied) return denied;
  await ensureTables();
  const body = await request.json() as { id?: unknown; name?: unknown; contact?: unknown; level?: unknown; gender?: unknown; notes?: unknown; addToQueue?: unknown };
  const name = normalizePlayerName(body.name);
  const contact = cleanText(body.contact, 80) || null;
  const level = normalizePlayerLevel(body.level);
  const gender = ["male", "female"].includes(String(body.gender)) ? String(body.gender) : "";
  const notes = cleanText(body.notes, 500) || null;
  if (!name) return Response.json({ error: "Player name is required" }, { status: 400 });
  if (!gender) return Response.json({ error: "Please select a gender" }, { status: 400 });
  if (!body.level || !["A", "B", "C", "D", "E"].includes(String(body.level).toUpperCase())) return Response.json({ error: "Please select a player level" }, { status: 400 });
  const db = getDb();
  const id = cleanText(body.id, 80) || crypto.randomUUID();
  if (await findPlayerNameConflict(db, name, id)) {
    return Response.json({ error: duplicatePlayerNameMessage(name) }, { status: 409 });
  }
  const now = Date.now();
  const statements = [
    db.insert(players).values({ id, name, normalizedName: name, contact, level, gender, notes, createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: players.id, set: { name, normalizedName: name, contact, level, gender, notes, updatedAt: now } }),
    db.insert(activityLogs).values({ id: crypto.randomUUID(), type: "player_added", playerId: id, playerName: name, details: JSON.stringify({ level, gender }), createdAt: now }),
  ];
  if (body.addToQueue === true) {
    statements.push(db.insert(queueEntries).values({ id, playerId: id, playerName: name, playerLevel: level, playerGender: gender, joinedAt: now, status: "waiting", notes, updatedAt: now }).onConflictDoUpdate({ target: queueEntries.id, set: { playerName: name, playerLevel: level, playerGender: gender, joinedAt: now, status: "waiting", standbyTableNumber: null, notes, updatedAt: now } }) as never);
    statements.push(db.insert(activityLogs).values({ id: crypto.randomUUID(), type: "queue_joined", playerId: id, playerName: name, details: JSON.stringify({ source: "front_desk" }), createdAt: now }) as never);
  }
  try {
    await db.batch(statements as never);
  } catch (error) {
    if (isPlayerNameUniqueConstraintError(error)) return Response.json({ error: duplicatePlayerNameMessage(name) }, { status: 409 });
    throw error;
  }
  return Response.json({ ok: true, id }, { status: 201 });
}

export async function PATCH(request: Request) {
  const denied = await requireApiStaff();
  if (denied) return denied;
  await ensureTables();
  const body = await request.json() as { id?: unknown; name?: unknown; level?: unknown; gender?: unknown };
  const id = cleanText(body.id, 80);
  const name = normalizePlayerName(body.name);
  const gender = ["male", "female"].includes(String(body.gender)) ? String(body.gender) : "";
  const level = normalizePlayerLevel(body.level);
  if (!id) return Response.json({ error: "Player is required" }, { status: 400 });
  if (!name) return Response.json({ error: "Please enter the player's name" }, { status: 400 });
  if (!gender) return Response.json({ error: "Please select a gender" }, { status: 400 });
  if (!body.level || !["A", "B", "C", "D", "E"].includes(String(body.level).toUpperCase())) return Response.json({ error: "Please select a player level" }, { status: 400 });
  const db = getDb();
  const [player] = await db.select().from(players).where(eq(players.id, id)).limit(1);
  if (!player) return Response.json({ error: "Player not found" }, { status: 404 });
  if (await findPlayerNameConflict(db, name, id)) {
    return Response.json({ error: duplicatePlayerNameMessage(name) }, { status: 409 });
  }
  const now = Date.now();
  try {
    await db.batch([
    db.update(players).set({ name, normalizedName: name, gender, level, updatedAt: now }).where(eq(players.id, id)),
    db.update(queueEntries).set({ playerName: name, playerGender: gender, playerLevel: level, updatedAt: now }).where(eq(queueEntries.playerId, id)),
    db.update(activeGamePlayers).set({ playerName: name, playerGender: gender, playerLevel: level }).where(eq(activeGamePlayers.playerId, id)),
    db.update(gameBillings).set({ playerName: name, updatedAt: now }).where(eq(gameBillings.playerId, id)),
    db.insert(activityLogs).values({ id: crypto.randomUUID(), type: "player_updated", playerId: id, playerName: name, details: JSON.stringify({ previousName: player.name, gender, level }), createdAt: now }),
    ]);
  } catch (error) {
    if (isPlayerNameUniqueConstraintError(error)) return Response.json({ error: duplicatePlayerNameMessage(name) }, { status: 409 });
    throw error;
  }
  return Response.json({ ok: true });
}
