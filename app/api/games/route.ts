import { and, desc, eq, gte, inArray, like, lt, lte, sql } from "drizzle-orm";
import { ensureTables, getDb } from "../../../db";
import { activeGamePlayers, activeGames, activityLogs, courts, gameBillings, matchPlayers, matches, players, queueEntries, reservations } from "../../../db/schema";
import { cleanText, duplicatePlayerNameMessage, integerParam, isPlayerNameUniqueConstraintError, normalizePlayerName, parseJsonArray } from "../../../lib/domain";
import { findPlayerNameConflict, hasDuplicateIncomingPlayerNames } from "../../../lib/player-names";
import { calculatePlayerCharges, isShuttlecockId, NO_SHUTTLECOCK, SHUTTLECOCKS, shuttlecockTotalPriceCentavos } from "../../../lib/shuttlecocks";
import { rangeFromSearchParams } from "../../../lib/time";
import { normalizePlayerLevel } from "../../../lib/player-levels";
import { getChatGPTUser, requireApiStaff } from "../../chatgpt-auth";

type IncomingPlayer = { id?: unknown; name?: unknown; contact?: unknown; level?: unknown; gender?: unknown };
type PlayerCost = { playerId: string; playerName: string; costCentavos: number };

export async function GET(request: Request) {
  const denied = await requireApiStaff();
  if (denied) return denied;
  await ensureTables();
  const db = getDb();
  const url = new URL(request.url);
  const filters = [eq(matches.status, "completed")];
  const range = rangeFromSearchParams(url.searchParams);
  if (range) filters.push(gte(matches.endedAt, range[0]), lt(matches.endedAt, range[1]));
  const courtId = integerParam(url.searchParams.get("courtId"));
  if (courtId) filters.push(eq(matches.courtId, courtId));
  const shuttlecock = cleanText(url.searchParams.get("shuttlecock"));
  if (shuttlecock) filters.push(eq(matches.shuttlecockName, shuttlecock));
  const player = cleanText(url.searchParams.get("player"), 80);
  if (player) filters.push(like(matches.playerNames, `%${player}%`));
  const limit = Math.min(integerParam(url.searchParams.get("limit")) ?? 100, 200);
  const rows = await db.select().from(matches).where(and(...filters)).orderBy(desc(matches.endedAt)).limit(limit);
  return Response.json(rows.map((row) => ({ ...row, playerNames: parseJsonArray<string>(row.playerNames).map((name) => normalizePlayerName(name)), playerCosts: parseJsonArray<PlayerCost>(row.playerCosts).map((cost) => ({ ...cost, playerName: normalizePlayerName(cost.playerName) })), queueOrder: parseJsonArray<string>(row.queueOrder).map((name) => normalizePlayerName(name)) })));
}

export async function POST(request: Request) {
  const denied = await requireApiStaff();
  if (denied) return denied;
  await ensureTables();
  const body = await request.json() as { action?: unknown; courtId?: unknown; reservationId?: unknown; shuttlecockId?: unknown; players?: IncomingPlayer[]; gameId?: unknown; queueOrder?: unknown; winnerName?: unknown; notes?: unknown };
  if (body.action === "finish") return finishGame(cleanText(body.gameId, 80), normalizePlayerName(body.winnerName, 200) || null, cleanText(body.notes, 500) || null);
  if (body.action !== "start") return Response.json({ error: "Invalid game action" }, { status: 400 });
  const courtId = Number(body.courtId);
  const reservationId = cleanText(body.reservationId, 80) || null;
  // Walk-ins (no reservation) can start with just 1 player, but every game —
  // walk-in or reservation-backed — now requires a real, valid shuttlecock.
  const isWalkIn = !reservationId;
  const minPlayers = isWalkIn ? 1 : 2;
  const shuttlecockValid = body.shuttlecockId === undefined || body.shuttlecockId === null || body.shuttlecockId === "" || body.shuttlecockId === NO_SHUTTLECOCK.id || isShuttlecockId(body.shuttlecockId);
  if (!Number.isInteger(courtId) || courtId < 1 || courtId > 9 || !Array.isArray(body.players) || body.players.length < minPlayers || body.players.length > 4 || !shuttlecockValid) {
    return Response.json({ error: isWalkIn ? "A court and at least 1 player are required" : "A court and 2–4 players are required" }, { status: 400 });
  }
  const normalized = body.players.map((player) => ({ id: cleanText(player.id, 80) || crypto.randomUUID(), name: normalizePlayerName(player.name), contact: cleanText(player.contact, 80) || null, level: normalizePlayerLevel(player.level), gender: ["male", "female"].includes(String(player.gender)) ? String(player.gender) : "unspecified" }));
  if (normalized.some((player) => !player.name) || new Set(normalized.map((player) => player.id)).size !== normalized.length || hasDuplicateIncomingPlayerNames(normalized)) return Response.json({ error: "Players must be unique and have names" }, { status: 400 });
  const db = getDb();
  for (const player of normalized) {
    if (await findPlayerNameConflict(db, player.name, player.id)) return Response.json({ error: duplicatePlayerNameMessage(player.name) }, { status: 409 });
  }
  const [court] = await db.select().from(courts).where(eq(courts.id, courtId)).limit(1);
  if (!court || court.maintenance) return Response.json({ error: "Court is unavailable for maintenance" }, { status: 409 });
  const [live] = await db.select({ id: activeGames.id }).from(activeGames).where(eq(activeGames.courtId, courtId)).limit(1);
  if (live) return Response.json({ error: "Court already has an active game" }, { status: 409 });
  const now = Date.now();
  const conflicting = await db.select({ id: reservations.id }).from(reservations).where(and(
    eq(reservations.courtId, courtId), lte(reservations.startsAt, now), gte(reservations.endsAt, now),
    inArray(reservations.status, ["confirmed", "checked_in", "playing"]),
  )).limit(2);
  if (conflicting.some((item) => item.id !== reservationId)) return Response.json({ error: "Court is reserved for another customer right now" }, { status: 409 });
  if (reservationId) {
    const [reservation] = await db.select().from(reservations).where(eq(reservations.id, reservationId)).limit(1);
    if (!reservation || ["cancelled", "no_show", "completed"].includes(reservation.status)) return Response.json({ error: "Reservation cannot be started" }, { status: 409 });
    if (reservation.courtId && reservation.courtId !== courtId) return Response.json({ error: "Reservation is assigned to another court" }, { status: 409 });
  }
  const shuttlecock = isShuttlecockId(body.shuttlecockId) ? SHUTTLECOCKS[body.shuttlecockId] : NO_SHUTTLECOCK;
  const shuttlecockTotal = shuttlecockTotalPriceCentavos(shuttlecock.id, normalized.length);
  const gameId = crypto.randomUUID();
  const user = await getChatGPTUser();
  const requestedQueueOrder = Array.isArray(body.queueOrder)
    ? body.queueOrder.map((item) => cleanText(item, 100)).filter(Boolean)
    : [];
  const queueOrder = requestedQueueOrder.length === normalized.length
    ? requestedQueueOrder
    : normalized.map((player) => player.name);
  const statements: unknown[] = [
    ...normalized.map((player) => db.insert(players).values({ id: player.id, name: player.name, normalizedName: player.name, contact: player.contact, level: player.level, gender: player.gender, createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: players.id, set: { name: player.name, normalizedName: player.name, contact: player.contact, level: player.level, gender: player.gender, updatedAt: now } })),
    db.insert(activeGames).values({ id: gameId, courtId, reservationId, shuttlecockId: shuttlecock.id, shuttlecockName: shuttlecock.name, shuttlecockPriceCentavos: shuttlecockTotal, startedAt: now, createdAt: now, queueOrder: JSON.stringify(queueOrder), managedBy: user?.displayName ?? null }),
    ...normalized.map((player) => db.insert(activeGamePlayers).values({ gameId, playerId: player.id, playerName: player.name, playerLevel: player.level, playerGender: player.gender })),
    ...normalized.map((player) => db.update(queueEntries).set({ status: "playing", standbyTableNumber: null, joinedAt: now, updatedAt: now }).where(eq(queueEntries.playerId, player.id))),
    db.insert(activityLogs).values({ id: crypto.randomUUID(), type: "court_assigned", courtId, gameId, reservationId, details: JSON.stringify({ players: normalized.map((player) => player.name) }), managedBy: user?.displayName ?? null, createdAt: now }),
  ];
  if (reservationId) statements.push(db.update(reservations).set({ courtId, status: "playing", updatedAt: now }).where(eq(reservations.id, reservationId)));
  try { await db.batch(statements as never); }
  catch (error) {
    if (isPlayerNameUniqueConstraintError(error)) return Response.json({ error: "A player with that name was added by another staff member. Refresh and try again." }, { status: 409 });
    return Response.json({ error: "Court or reservation was assigned by another staff member" }, { status: 409 });
  }
  return Response.json({ ok: true, gameId }, { status: 201 });
}

export async function PATCH(request: Request) {
  const denied = await requireApiStaff();
  if (denied) return denied;
  await ensureTables();
  const body = await request.json() as { action?: unknown; gameId?: unknown; courtId?: unknown; shuttlecockId?: unknown; players?: IncomingPlayer[] };
  const gameId = cleanText(body.gameId, 80);
  if (!gameId) return Response.json({ error: "An active game is required" }, { status: 400 });
  const db = getDb();
  const [game] = await db.select().from(activeGames).where(eq(activeGames.id, gameId)).limit(1);
  if (!game) return Response.json({ error: "Active game not found" }, { status: 404 });

  if (body.action === "lineup") {
    if (!Array.isArray(body.players) || body.players.length < 1 || body.players.length > 4) return Response.json({ error: "A lineup requires 1–4 players" }, { status: 400 });
    const lineup = body.players.map((player) => ({ id: cleanText(player.id, 80), name: normalizePlayerName(player.name), contact: cleanText(player.contact, 80) || null, level: normalizePlayerLevel(player.level), gender: ["male", "female"].includes(String(player.gender)) ? String(player.gender) : "unspecified" }));
    if (lineup.some((player) => !player.id || !player.name) || new Set(lineup.map((player) => player.id)).size !== lineup.length || hasDuplicateIncomingPlayerNames(lineup)) return Response.json({ error: "Lineup players must be unique" }, { status: 400 });
    for (const player of lineup) {
      if (await findPlayerNameConflict(db, player.name, player.id)) return Response.json({ error: duplicatePlayerNameMessage(player.name) }, { status: 409 });
    }
    const current = await db.select().from(activeGamePlayers).where(eq(activeGamePlayers.gameId, gameId));
    const oldIds = new Set(current.map((player) => player.playerId));
    const newIds = new Set(lineup.map((player) => player.id));
    const outgoing = current.filter((player) => !newIds.has(player.playerId));
    const incoming = lineup.filter((player) => !oldIds.has(player.id));
    const now = Date.now();
    const user = await getChatGPTUser();
    try {
      await db.batch([
        db.delete(activeGamePlayers).where(eq(activeGamePlayers.gameId, gameId)),
        db.update(activeGames).set({ queueOrder: JSON.stringify(lineup.map((player) => player.name)) }).where(eq(activeGames.id, gameId)),
        ...lineup.map((player) => db.insert(players).values({ id: player.id, name: player.name, normalizedName: player.name, contact: player.contact, level: player.level, gender: player.gender, createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: players.id, set: { name: player.name, normalizedName: player.name, level: player.level, gender: player.gender, updatedAt: now } })),
        ...lineup.map((player) => db.insert(activeGamePlayers).values({ gameId, playerId: player.id, playerName: player.name, playerLevel: player.level, playerGender: player.gender })),
        ...incoming.map((player) => db.update(queueEntries).set({ status: "playing", standbyTableNumber: null, joinedAt: now, updatedAt: now }).where(eq(queueEntries.playerId, player.id))),
        ...outgoing.map((player) => db.update(queueEntries).set({ status: "waiting", standbyTableNumber: null, joinedAt: now, updatedAt: now }).where(eq(queueEntries.playerId, player.playerId))),
        db.insert(activityLogs).values({ id: crypto.randomUUID(), type: "player_substitution", courtId: game.courtId, gameId, details: JSON.stringify({ outgoing: outgoing.map((player) => normalizePlayerName(player.playerName)), incoming: incoming.map((player) => player.name), lineup: lineup.map((player) => player.name) }), managedBy: user?.displayName ?? null, createdAt: now }),
      ] as never);
    } catch (error) {
      if (isPlayerNameUniqueConstraintError(error)) return Response.json({ error: "A player with that name was added by another staff member. Refresh and try again." }, { status: 409 });
      throw error;
    }
    return Response.json({ ok: true, timerPreserved: true, players: lineup });
  }

  const hasCourtMove = body.courtId !== undefined && body.courtId !== null;
  const hasShuttlecockChange = body.shuttlecockId !== undefined && body.shuttlecockId !== null;
  if (!hasCourtMove && !hasShuttlecockChange) {
    return Response.json({ error: "Provide a destination court or a new shuttlecock" }, { status: 400 });
  }

  if (hasShuttlecockChange) {
    if (body.shuttlecockId !== NO_SHUTTLECOCK.id && !isShuttlecockId(body.shuttlecockId)) return Response.json({ error: "A valid shuttlecock is required" }, { status: 400 });
    const shuttlecock = isShuttlecockId(body.shuttlecockId) ? SHUTTLECOCKS[body.shuttlecockId] : NO_SHUTTLECOCK;
    const gamePlayers = await db.select({ playerId: activeGamePlayers.playerId }).from(activeGamePlayers).where(eq(activeGamePlayers.gameId, gameId));
    const shuttlecockTotal = shuttlecockTotalPriceCentavos(shuttlecock.id, gamePlayers.length);
    try {
      await db.update(activeGames).set({
        shuttlecockId: shuttlecock.id,
        shuttlecockName: shuttlecock.name,
        shuttlecockPriceCentavos: shuttlecockTotal,
      }).where(eq(activeGames.id, gameId));
      const user = await getChatGPTUser();
      await db.insert(activityLogs).values({ id: crypto.randomUUID(), type: "shuttlecock_updated", courtId: game.courtId, gameId, details: JSON.stringify({ shuttlecockId: shuttlecock.id, shuttlecockName: shuttlecock.name, totalCentavos: shuttlecockTotal }), managedBy: user?.displayName ?? null, createdAt: Date.now() });
    } catch { return Response.json({ error: "Could not update the shuttlecock" }, { status: 409 }); }
  }

  if (hasCourtMove) {
    const courtId = Number(body.courtId);
    if (!Number.isInteger(courtId) || courtId < 1 || courtId > 9) return Response.json({ error: "A valid destination court is required" }, { status: 400 });
    if (game.courtId !== courtId) {
      const [destination] = await db.select().from(courts).where(eq(courts.id, courtId)).limit(1);
      if (!destination || destination.maintenance) return Response.json({ error: "Destination court is unavailable" }, { status: 409 });
      const [occupied] = await db.select({ id: activeGames.id }).from(activeGames).where(eq(activeGames.courtId, courtId)).limit(1);
      if (occupied) return Response.json({ error: "Destination court already has an active game" }, { status: 409 });
      try { await db.update(activeGames).set({ courtId }).where(eq(activeGames.id, gameId)); const user = await getChatGPTUser(); await db.insert(activityLogs).values({ id: crypto.randomUUID(), type: "court_moved", courtId, gameId, details: JSON.stringify({ fromCourtId: game.courtId, toCourtId: courtId }), managedBy: user?.displayName ?? null, createdAt: Date.now() }); }
      catch { return Response.json({ error: "Could not move the game" }, { status: 409 }); }
    }
  }

  return Response.json({ ok: true });
}

async function finishGame(gameId: string, winnerName: string | null, matchNotes: string | null) {
  if (!gameId) return Response.json({ error: "Game ID is required" }, { status: 400 });
  const db = getDb();
  const [game] = await db.select().from(activeGames).where(eq(activeGames.id, gameId)).limit(1);
  if (!game) return Response.json({ error: "Active game not found" }, { status: 404 });
  const gamePlayers = (await db.select().from(activeGamePlayers).where(eq(activeGamePlayers.gameId, gameId))).map((player) => ({ ...player, playerName: normalizePlayerName(player.playerName) }));
  if (!gamePlayers.length || game.shuttlecockPriceCentavos < 0) return Response.json({ error: "Game has invalid players or shuttlecock pricing" }, { status: 409 });
  const teamSplit = Math.ceil(gamePlayers.length / 2);
  const teams = [gamePlayers.slice(0, teamSplit), gamePlayers.slice(teamSplit)].filter((team) => team.length);
  const validWinners = teams.map((team) => team.map((player) => player.playerName).join(" & "));
  if (!winnerName) return Response.json({ error: "Select the winning team before finishing the match" }, { status: 400 });
  if (!validWinners.includes(winnerName)) return Response.json({ error: "Select one of the current teams as the winner" }, { status: 400 });
  const endedAt = Date.now();
  if (endedAt < game.startedAt) return Response.json({ error: "Invalid game duration" }, { status: 409 });
  const billingRows = await db.select().from(gameBillings).where(and(eq(gameBillings.gameId, gameId), eq(gameBillings.status, "active")));
  const hasCustomBilling = billingRows.length === gamePlayers.length && gamePlayers.every((player) => billingRows.some((billing) => billing.playerId === player.playerId));
  const defaultCharges = calculatePlayerCharges(game.shuttlecockPriceCentavos, gamePlayers.length);
  const charges = gamePlayers.map((player, index) => hasCustomBilling ? billingRows.find((billing) => billing.playerId === player.playerId)!.totalDueCentavos : defaultCharges[index]);
  const playerCosts = gamePlayers.map((player, index) => ({ playerId: player.playerId, playerName: player.playerName, costCentavos: charges[index] }));
  const billingTotalCentavos = charges.reduce((sum, charge) => sum + charge, 0);
  const billingSummary = hasCustomBilling ? billingRows.map((row) => ({ playerId: row.playerId, playerName: row.playerName, betAmountCentavos: row.betAmountCentavos, shuttlecockContributionCentavos: row.shuttlecockContributionCentavos, additionalCharges: JSON.parse(row.additionalCharges || "[]"), additionalTotalCentavos: row.additionalTotalCentavos, totalDueCentavos: row.totalDueCentavos, paymentStatus: row.paymentStatus, winner: row.winner, notes: row.notes })) : playerCosts;
  const recordedWinner = winnerName;
  const explicitWinningIds = new Set((teams[validWinners.indexOf(winnerName)] ?? []).map((player) => player.playerId));
  const substitutionLogs = await db.select({ id: activityLogs.id }).from(activityLogs).where(and(eq(activityLogs.gameId, gameId), eq(activityLogs.type, "player_substitution")));
  const [court] = await db.select({ name: courts.name, number: courts.number }).from(courts).where(eq(courts.id, game.courtId)).limit(1);
  const statements = [
    db.insert(matches).values({ id: game.id, courtId: game.courtId, courtName: court?.name ?? `Court ${court?.number ?? game.courtId}`, playerNames: JSON.stringify(gamePlayers.map((player) => player.playerName)), startedAt: game.startedAt, endedAt, shuttlecockName: game.shuttlecockName, shuttlecockPriceCentavos: game.shuttlecockPriceCentavos, costPerPlayerCentavos: charges[0] ?? 0, playerCosts: JSON.stringify(playerCosts), reservationId: game.reservationId, status: "completed", winnerName: recordedWinner, queueOrder: game.queueOrder, managedBy: game.managedBy, billingTotalCentavos, billingSummary: JSON.stringify(billingSummary), substitutionCount: substitutionLogs.length, matchNotes }),
    ...gamePlayers.map((player, index) => db.insert(matchPlayers).values({ matchId: game.id, playerId: player.playerId, playerName: player.playerName, playerLevel: player.playerLevel, playerGender: player.playerGender, winner: explicitWinningIds.has(player.playerId), costCentavos: charges[index] })),
    ...gamePlayers.map((player, index) => db.update(players).set({ timesPlayed: sql`${players.timesPlayed} + 1`, totalBillCentavos: sql`${players.totalBillCentavos} + ${charges[index]}`, updatedAt: endedAt }).where(eq(players.id, player.playerId))),
    ...(game.reservationId ? [db.update(reservations).set({ status: "completed", updatedAt: endedAt }).where(eq(reservations.id, game.reservationId))] : []),
    ...gamePlayers.map((player) => db.update(queueEntries).set({ status: "waiting", standbyTableNumber: null, joinedAt: endedAt, updatedAt: endedAt }).where(eq(queueEntries.playerId, player.playerId))),
    db.update(gameBillings).set({ status: "completed", updatedAt: endedAt }).where(eq(gameBillings.gameId, game.id)),
    db.insert(activityLogs).values({ id: crypto.randomUUID(), type: "game_completed", courtId: game.courtId, gameId: game.id, reservationId: game.reservationId, details: JSON.stringify({ players: gamePlayers.map((player) => player.playerName), winner: recordedWinner, billingTotalCentavos, notes: matchNotes }), managedBy: game.managedBy, createdAt: endedAt }),
    db.delete(activeGamePlayers).where(eq(activeGamePlayers.gameId, game.id)),
    db.delete(activeGames).where(eq(activeGames.id, game.id)),
  ];
  await db.batch(statements as [typeof statements[number], ...typeof statements[number][]]);
  return Response.json({ ok: true, gameId: game.id, playerCosts, revenueCentavos: billingTotalCentavos });
}
