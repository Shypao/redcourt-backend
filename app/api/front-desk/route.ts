import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { ensureTables, getDb } from "../../../db";
import { activeGamePlayers, activeGames, courts, gameBillings, matches, reservations } from "../../../db/schema";
import { manilaDayRange } from "../../../lib/time";
import { normalizePlayerName } from "../../../lib/domain";
import { requireApiStaff } from "../../chatgpt-auth";

export async function GET() {
  const denied = await requireApiStaff();
  if (denied) return denied;
  await ensureTables();
  const db = getDb();
  const now = Date.now();
  const [dayStart, dayEnd] = manilaDayRange(now);
  const [courtRows, liveGames, todayReservations, completedGames] = await Promise.all([
    db.select().from(courts).orderBy(asc(courts.number)),
    db.select().from(activeGames).orderBy(asc(activeGames.courtId)),
    db.select().from(reservations).where(and(gte(reservations.startsAt, dayStart), lt(reservations.startsAt, dayEnd))).orderBy(asc(reservations.startsAt)),
    db.select().from(matches).where(and(eq(matches.status, "completed"), gte(matches.endedAt, dayStart), lt(matches.endedAt, dayEnd))).orderBy(desc(matches.endedAt)).limit(25),
  ]);
  const livePlayers = liveGames.length ? await db.select().from(activeGamePlayers).where(inArray(activeGamePlayers.gameId, liveGames.map((game) => game.id))) : [];
  const liveBillings = liveGames.length ? await db.select().from(gameBillings).where(inArray(gameBillings.gameId, liveGames.map((game) => game.id))) : [];
  return Response.json({
    generatedAt: now,
    courts: courtRows.map((court) => {
      const game = liveGames.find((item) => item.courtId === court.id);
      const reservation = todayReservations.find((item) => item.courtId === court.id && item.startsAt <= now && item.endsAt >= now && ["pending", "confirmed", "checked_in"].includes(item.status));
      return {
        ...court,
        status: court.maintenance ? "maintenance" : game ? "playing" : reservation ? "reserved" : "available",
        game: game ? { ...game, players: orderedGamePlayers(game.queueOrder, livePlayers.filter((player) => player.gameId === game.id)), shuttlecocksUsed: game.shuttlecockPriceCentavos > 0 ? 1 : 0, currentRevenueCentavos: liveBillings.filter((row) => row.gameId === game.id).reduce((sum, row) => sum + row.totalDueCentavos, 0) || game.shuttlecockPriceCentavos, bettingCentavos: liveBillings.filter((row) => row.gameId === game.id).reduce((sum, row) => sum + row.betAmountCentavos, 0), bettingStatus: liveBillings.some((row) => row.gameId === game.id && row.betAmountCentavos > 0) ? "Bets recorded" : "No bets" } : null,
        reservation: reservation ? { ...reservation, customerName: normalizePlayerName(reservation.customerName) } : null,
      };
    }),
    reservations: todayReservations.map((reservation) => ({ ...reservation, customerName: normalizePlayerName(reservation.customerName) })),
    completedGames: completedGames.map((match) => ({ ...match, playerNames: JSON.stringify(JSON.parse(match.playerNames || "[]").map((name: unknown) => normalizePlayerName(name))) })),
  });
}

function orderedGamePlayers(queueOrder: string, gamePlayers: (typeof activeGamePlayers.$inferSelect)[]) {
  let names: string[] = [];
  try {
    const parsed = JSON.parse(queueOrder);
    if (Array.isArray(parsed)) names = parsed.map((name) => normalizePlayerName(name));
  } catch {
    // Older or malformed metadata falls back to the player rows below.
  }
  const position = new Map(names.map((name, index) => [name, index]));
  return gamePlayers
    .map((player) => ({ ...player, playerName: normalizePlayerName(player.playerName) }))
    .sort((a, b) => (position.get(a.playerName) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.playerName) ?? Number.MAX_SAFE_INTEGER));
}

export async function PATCH(request: Request) {
  const denied = await requireApiStaff();
  if (denied) return denied;
  await ensureTables();
  const body = await request.json() as { courtId?: unknown; maintenance?: unknown; note?: unknown };
  const courtId = Number(body.courtId);
  if (!Number.isInteger(courtId) || courtId < 1 || courtId > 9 || typeof body.maintenance !== "boolean") return Response.json({ error: "Invalid court update" }, { status: 400 });
  const db = getDb();
  const [active] = await db.select({ id: activeGames.id }).from(activeGames).where(eq(activeGames.courtId, courtId)).limit(1);
  if (active && body.maintenance) return Response.json({ error: "Finish the active game before maintenance" }, { status: 409 });
  await db.update(courts).set({ maintenance: body.maintenance, maintenanceNote: typeof body.note === "string" ? body.note.trim().slice(0, 200) || null : null, updatedAt: Date.now() }).where(eq(courts.id, courtId));
  return Response.json({ ok: true });
}
