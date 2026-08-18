import { asc, eq, inArray } from "drizzle-orm";
import { ensureTables, getDb } from "../../../db";
import { activityLogs, players, queueEntries, reservations } from "../../../db/schema";
import { cleanText, duplicatePlayerNameMessage, isPlayerNameUniqueConstraintError, normalizePlayerName } from "../../../lib/domain";
import { findPlayerNameConflict } from "../../../lib/player-names";
import { normalizePlayerLevel } from "../../../lib/player-levels";
import { createStandbyGroups, type MatchingMode } from "../../../lib/matching";
import { getChatGPTUser, requireApiStaff } from "../../chatgpt-auth";

const WAIT_LIMIT_MS = 15 * 60_000;

export async function GET() {
  const denied = await requireApiStaff();
  if (denied) return denied;
  await ensureTables();
  const db = getDb();
  const generatedAt = Date.now();
  const rows = await db.select().from(queueEntries).where(inArray(queueEntries.status, ["waiting", "standby"])).orderBy(asc(queueEntries.joinedAt));
  const waiting = rows.filter((row) => row.status === "waiting").map((row) => ({
    id: row.playerId, name: normalizePlayerName(row.playerName), level: normalizePlayerLevel(row.playerLevel), gender: row.playerGender, joinedAt: row.joinedAt,
    priority: generatedAt - row.joinedAt >= WAIT_LIMIT_MS, reservationId: row.reservationId, notes: row.notes,
  })).sort((a, b) => Number(b.priority) - Number(a.priority) || a.joinedAt - b.joinedAt);
  const grouped = new Map<number, typeof waiting>();
  for (const row of rows.filter((entry) => entry.status === "standby")) {
    const table = row.standbyTableNumber ?? 1;
    const list = grouped.get(table) ?? [];
    list.push({ id: row.playerId, name: normalizePlayerName(row.playerName), level: normalizePlayerLevel(row.playerLevel), gender: row.playerGender, joinedAt: row.joinedAt, priority: false, reservationId: row.reservationId, notes: row.notes });
    grouped.set(table, list);
  }
  const standbyTables = [...grouped.entries()].sort(([a], [b]) => a - b).map(([tableNumber, tablePlayers]) => ({ tableNumber, players: tablePlayers, ready: tablePlayers.length === 4 }));
  return Response.json({ generatedAt, waitLimitMs: WAIT_LIMIT_MS, queue: waiting, standbyTables });
}

export async function POST(request: Request) {
  const denied = await requireApiStaff();
  if (denied) return denied;
  await ensureTables();
  const body = await request.json() as { id?: unknown; name?: unknown; level?: unknown; gender?: unknown; reservationId?: unknown; notes?: unknown };
  const db = getDb();
  const reservationId = cleanText(body.reservationId, 80) || null;
  let playerId = cleanText(body.id, 80) || crypto.randomUUID();
  let name = normalizePlayerName(body.name);
  if (reservationId) {
    const [reservation] = await db.select().from(reservations).where(eq(reservations.id, reservationId)).limit(1);
    if (!reservation) return Response.json({ error: "Reservation not found" }, { status: 404 });
    if (["playing", "completed", "cancelled", "no_show"].includes(reservation.status)) {
      return Response.json({ error: "This reservation cannot be added to the queue" }, { status: 409 });
    }
    // Reservation check-in must reuse the canonical player identity created
    // with the reservation. A synthetic ID would trip duplicate-name checks.
    playerId = reservation.customerPlayerId;
    name = normalizePlayerName(reservation.customerName);
  }
  const level = normalizePlayerLevel(body.level);
  const gender = ["male", "female"].includes(String(body.gender)) ? String(body.gender) : "";
  if (!name) return Response.json({ error: "Player name is required" }, { status: 400 });
  if (!gender) return Response.json({ error: "Please select a gender" }, { status: 400 });
  if (!body.level || !["A", "B", "C", "D", "E"].includes(String(body.level).toUpperCase())) return Response.json({ error: "Please select a player level" }, { status: 400 });
  const now = Date.now();
  if (await findPlayerNameConflict(db, name, playerId)) {
    return Response.json({ error: duplicatePlayerNameMessage(name) }, { status: 409 });
  }
  const user = await getChatGPTUser();
  try {
    await db.batch([
    db.insert(players).values({ id: playerId, name, normalizedName: name, level, gender, createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: players.id, set: { name, normalizedName: name, level, gender, updatedAt: now } }),
    db.insert(queueEntries).values({ id: playerId, playerId, playerName: name, playerLevel: level, playerGender: gender, joinedAt: now, status: "waiting", reservationId, notes: cleanText(body.notes, 300) || null, updatedAt: now }).onConflictDoUpdate({ target: queueEntries.id, set: { playerName: name, playerLevel: level, playerGender: gender, joinedAt: now, status: "waiting", standbyTableNumber: null, reservationId, notes: cleanText(body.notes, 300) || null, updatedAt: now } }),
    ...(reservationId ? [db.update(reservations).set({ status: "checked_in", updatedAt: now }).where(eq(reservations.id, reservationId))] : []),
    db.insert(activityLogs).values({ id: crypto.randomUUID(), type: "queue_joined", playerId, playerName: name, details: JSON.stringify({ level }), managedBy: user?.displayName ?? null, createdAt: now }),
    ] as never);
  } catch (error) {
    if (isPlayerNameUniqueConstraintError(error)) return Response.json({ error: duplicatePlayerNameMessage(name) }, { status: 409 });
    throw error;
  }
  return Response.json({ ok: true, id: playerId, joinedAt: now }, { status: 201 });
}

export async function PATCH(request: Request) {
  const denied = await requireApiStaff();
  if (denied) return denied;
  await ensureTables();
  const body = await request.json() as { action?: unknown; playerIds?: unknown; playerId?: unknown; tableNumber?: unknown; notes?: unknown; level?: unknown; mode?: unknown };
  const action = cleanText(body.action, 30);
  if (action === "auto_pair") {
    const mode = cleanText(body.mode, 30) as MatchingMode;
    if (!["match_level", "mixed_level", "mens", "womens", "mixed_doubles", "random"].includes(mode)) return Response.json({ error: "Invalid pairing mode" }, { status: 400 });
    const db = getDb();
    const waiting = await db.select().from(queueEntries).where(inArray(queueEntries.status, ["waiting"])).orderBy(asc(queueEntries.joinedAt));
    const groups = createStandbyGroups(waiting.map((row) => ({ ...row, gender: row.playerGender, level: row.playerLevel })), mode);
    if (!groups.length) return Response.json({ error: "Not enough eligible players to create a table" }, { status: 409 });
    const existing = await db.select().from(queueEntries).where(inArray(queueEntries.status, ["standby"]));
    let tableNumber = Math.max(0, ...existing.map((row) => row.standbyTableNumber ?? 0)) + 1;
    const now = Date.now();
    const user = await getChatGPTUser();
    const statements = groups.flatMap((group) => {
      const assigned = tableNumber++;
      return [
        // Persist the exact generated lineup order. Standby GET responses sort
        // by joinedAt, so one timestamp per position prevents M+F vs M+F from
        // being rearranged back into arrival order after a refresh.
        ...group.map((player, playerIndex) => db.update(queueEntries).set({ status: "standby", standbyTableNumber: assigned, joinedAt: now + playerIndex, updatedAt: now }).where(eq(queueEntries.playerId, player.playerId))),
        db.insert(activityLogs).values({ id: crypto.randomUUID(), type: "auto_pairing", details: JSON.stringify({ mode, tableNumber: assigned, players: group.map((player) => player.playerName) }), managedBy: user?.displayName ?? null, createdAt: now }),
      ];
    });
    await db.batch(statements as never);
    return Response.json({ ok: true, tablesCreated: groups.length, playersPaired: groups.length * 4 });
  }
  const ids = Array.isArray(body.playerIds) ? body.playerIds.map((id) => cleanText(id, 80)).filter(Boolean) : [cleanText(body.playerId, 80)].filter(Boolean);
  if (!ids.length || !["standby", "back", "remove", "notes", "level"].includes(action)) return Response.json({ error: "Invalid queue action" }, { status: 400 });
  const db = getDb();
  const now = Date.now();
  const entries = await db.select().from(queueEntries).where(inArray(queueEntries.playerId, ids));
  if (!entries.length) return Response.json({ error: "Queue player not found" }, { status: 404 });
  const user = await getChatGPTUser();
  const tableNumber = Number(body.tableNumber);
  const assignedTableNumber = Number.isInteger(tableNumber) && tableNumber > 0 ? tableNumber : 1;
  const updates = action === "standby"
    ? { status: "standby", standbyTableNumber: assignedTableNumber, joinedAt: now, updatedAt: now }
    : action === "back"
      ? { status: "waiting", standbyTableNumber: null, joinedAt: now, updatedAt: now }
      : action === "remove"
        ? { status: "removed", standbyTableNumber: null, updatedAt: now }
        : action === "level"
            ? { playerLevel: normalizePlayerLevel(body.level), updatedAt: now }
            : { notes: cleanText(body.notes, 300) || null, updatedAt: now };
  const logType = action === "standby" ? "standby_assigned" : action === "back" ? "queue_returned" : action === "remove" ? "queue_removed" : action === "level" ? "player_level_changed" : "queue_notes_updated";
  const queueUpdates = action === "standby"
    // `ids` is the order in which the staff selected the players. Keep that
    // exact order so positions 1+2 and 3+4 remain the intended teams after a
    // refresh (for example 1,4,2,3 becomes 1 & 4 vs 2 & 3).
    ? ids.map((id, playerIndex) => db.update(queueEntries).set({ ...updates, joinedAt: now + playerIndex }).where(eq(queueEntries.playerId, id)))
    : [db.update(queueEntries).set(updates).where(inArray(queueEntries.playerId, ids))];
  const statements = [
    ...queueUpdates,
    ...(action === "level" ? [db.update(players).set({ level: normalizePlayerLevel(body.level), updatedAt: now }).where(inArray(players.id, ids))] : []),
    ...entries.map((entry) => db.insert(activityLogs).values({ id: crypto.randomUUID(), type: logType, playerId: entry.playerId, playerName: entry.playerName, details: JSON.stringify({ tableNumber: action === "standby" ? updates.standbyTableNumber : null }), managedBy: user?.displayName ?? null, createdAt: now })),
  ];
  await db.batch(statements as never);
  return Response.json({ ok: true });
}
