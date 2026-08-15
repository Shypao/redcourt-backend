import { and, count, countDistinct, desc, eq, gte, lt, sql } from "drizzle-orm";
import { ensureTables, getDb } from "../../../db";
import { gameBillings, matchPlayers, matches, reservations } from "../../../db/schema";
import { cleanText, integerParam, isReservationStatus, normalizePlayerName } from "../../../lib/domain";
import { manilaDateParts, manilaDayRange, manilaMonthRange, rangeFromSearchParams } from "../../../lib/time";
import { requireApiStaff } from "../../chatgpt-auth";

export async function GET(request: Request) {
  const denied = await requireApiStaff();
  if (denied) return denied;
  await ensureTables();
  const db = getDb();
  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "daily";
  const now = Date.now();
  const current = manilaDateParts(now);
  const year = integerParam(url.searchParams.get("year")) ?? current.year;
  const month = integerParam(url.searchParams.get("month")) ?? current.month;
  const range = rangeFromSearchParams(url.searchParams) ?? (type === "daily" ? manilaDayRange(now) : manilaMonthRange(year, month));
  const gameFilters = [eq(matches.status, "completed"), gte(matches.endedAt, range[0]), lt(matches.endedAt, range[1])];
  const reservationFilters = [gte(reservations.startsAt, range[0]), lt(reservations.startsAt, range[1])];
  const status = url.searchParams.get("status");
  if (status && isReservationStatus(status)) reservationFilters.push(eq(reservations.status, status));
  const courtId = integerParam(url.searchParams.get("courtId"));
  if (courtId) { reservationFilters.push(eq(reservations.courtId, courtId)); gameFilters.push(eq(matches.courtId, courtId)); }
  const gameDate = and(...gameFilters);
  const [gameTotals] = await db.select({ totalGames: count(), revenueCentavos: sql<number>`coalesce(sum(case when ${matches.billingTotalCentavos} > 0 then ${matches.billingTotalCentavos} else ${matches.shuttlecockPriceCentavos} end), 0)` }).from(matches).where(gameDate);
  const reservationRows = await db.select({ status: reservations.status, total: count() }).from(reservations).where(and(...reservationFilters)).groupBy(reservations.status);
  const reservationCounts = Object.fromEntries(reservationRows.map((row) => [row.status, row.total]));
  const [active] = await db.select({ total: countDistinct(matchPlayers.playerId) }).from(matchPlayers).innerJoin(matches, eq(matchPlayers.matchId, matches.id)).where(gameDate);
  const shuttlecockUsage = await db.select({ name: matches.shuttlecockName, games: count() }).from(matches).where(gameDate).groupBy(matches.shuttlecockName).orderBy(desc(count()));
  const playerFilter = cleanText(url.searchParams.get("playerId"), 80);
  const playerActivity = await db.select({ id: matchPlayers.playerId, name: matchPlayers.playerName, gender: matchPlayers.playerGender, gamesPlayed: count(), totalBillCentavos: sql<number>`coalesce(sum(${matchPlayers.costCentavos}), 0)` }).from(matchPlayers).innerJoin(matches, eq(matchPlayers.matchId, matches.id)).where(and(gameDate, playerFilter ? eq(matchPlayers.playerId, playerFilter) : undefined)).groupBy(matchPlayers.playerId, matchPlayers.playerName, matchPlayers.playerGender).orderBy(desc(count()), matchPlayers.playerName).limit(100);
  const billingRows = await db.select({ gameId: gameBillings.gameId, playerId: gameBillings.playerId, playerName: gameBillings.playerName, betAmountCentavos: gameBillings.betAmountCentavos, shuttlecockContributionCentavos: gameBillings.shuttlecockContributionCentavos, additionalTotalCentavos: gameBillings.additionalTotalCentavos, totalDueCentavos: gameBillings.totalDueCentavos, paymentStatus: gameBillings.paymentStatus, updatedAt: gameBillings.updatedAt }).from(gameBillings).innerJoin(matches, eq(gameBillings.gameId, matches.id)).where(gameDate).orderBy(desc(gameBillings.updatedAt)).limit(500);
  const billingSummary = billingRows.reduce((summary, row) => ({ betCentavos: summary.betCentavos + row.betAmountCentavos, shuttlecockCentavos: summary.shuttlecockCentavos + row.shuttlecockContributionCentavos, additionalCentavos: summary.additionalCentavos + row.additionalTotalCentavos, totalCentavos: summary.totalCentavos + row.totalDueCentavos, pendingCentavos: summary.pendingCentavos + (row.paymentStatus === "paid" ? 0 : row.totalDueCentavos) }), { betCentavos: 0, shuttlecockCentavos: 0, additionalCentavos: 0, totalCentavos: 0, pendingCentavos: 0 });
  return Response.json({ range: { start: range[0], end: range[1] }, totalGames: gameTotals.totalGames, totalRevenueCentavos: gameTotals.revenueCentavos, totalReservations: reservationRows.reduce((sum, row) => sum + row.total, 0), reservationCounts, activePlayers: active.total, playerActivity: playerActivity.map((player) => ({ ...player, name: normalizePlayerName(player.name) })), shuttlecockUsage, billingSummary, billingRows: billingRows.map((row) => ({ ...row, playerName: normalizePlayerName(row.playerName) })) });
}
