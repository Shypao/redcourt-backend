import { and, count, countDistinct, desc, eq, gt, gte, lt, sql } from "drizzle-orm";
import { ensureTables, getDb } from "../../../db";
import { gameBillings, matchPlayers, matches, playerCharges, playerPayments, players, reservations } from "../../../db/schema";
import { manilaDateParts, manilaDayRange, manilaMonthRange } from "../../../lib/time";
import { currentDayCutoff } from "../../../lib/day-session";
import { normalizePlayerName } from "../../../lib/domain";
import { requireApiStaff } from "../../chatgpt-auth";

function startOfTodayInManila(now = Date.now()) {
  const manilaOffsetMs = 8 * 60 * 60 * 1000;
  const shifted = new Date(now + manilaOffsetMs);
  return Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  ) - manilaOffsetMs;
}

export async function GET(request: Request) {
  const denied = await requireApiStaff();
  if (denied) return denied;
  await ensureTables();
  const db = getDb();
  const currentDay = new URL(request.url).searchParams.get("scope") === "current_day";
  const cutoff = currentDay ? await currentDayCutoff(db) : 0;
  const completedFilter = cutoff ? and(eq(matches.status, "completed"), gt(matches.endedAt, cutoff)) : eq(matches.status, "completed");
  const todayStart = startOfTodayInManila();
  const [, todayEnd] = manilaDayRange();
  const parts = manilaDateParts();
  const [monthStart, monthEnd] = manilaMonthRange(parts.year, parts.month);

  const [totals] = await db
    .select({
      totalGames: count(),
      totalRevenueCentavos: sql<number>`coalesce(sum(case when ${matches.billingTotalCentavos} > 0 then ${matches.billingTotalCentavos} else ${matches.shuttlecockPriceCentavos} end), 0)`,
      todayRevenueCentavos: sql<number>`coalesce(sum(case when ${matches.endedAt} >= ${todayStart} then case when ${matches.billingTotalCentavos} > 0 then ${matches.billingTotalCentavos} else ${matches.shuttlecockPriceCentavos} end else 0 end), 0)`,
      gamesToday: sql<number>`coalesce(sum(case when ${matches.endedAt} >= ${todayStart} and ${matches.endedAt} < ${todayEnd} then 1 else 0 end), 0)`,
      gamesThisMonth: sql<number>`coalesce(sum(case when ${matches.endedAt} >= ${monthStart} and ${matches.endedAt} < ${monthEnd} then 1 else 0 end), 0)`,
      monthlyRevenueCentavos: sql<number>`coalesce(sum(case when ${matches.endedAt} >= ${monthStart} and ${matches.endedAt} < ${monthEnd} then case when ${matches.billingTotalCentavos} > 0 then ${matches.billingTotalCentavos} else ${matches.shuttlecockPriceCentavos} end else 0 end), 0)`,
    })
    .from(matches).where(completedFilter);

  const [mostActivePlayer] = await db
    .select({ id: players.id, name: players.name, gamesPlayed: players.timesPlayed })
    .from(players)
    .orderBy(desc(players.timesPlayed), players.name)
    .limit(1);

  const [mostUsedShuttlecock] = await db
    .select({ name: matches.shuttlecockName, games: count() })
    .from(matches)
    .where(and(completedFilter, gte(matches.shuttlecockPriceCentavos, 1)))
    .groupBy(matches.shuttlecockName)
    .orderBy(desc(count()), matches.shuttlecockName)
    .limit(1);

  const [activePlayers] = await db.select({ total: countDistinct(matchPlayers.playerId) }).from(matchPlayers).innerJoin(matches, eq(matchPlayers.matchId, matches.id)).where(currentDay ? completedFilter : and(eq(matches.status, "completed"), gte(matches.endedAt, monthStart), lt(matches.endedAt, monthEnd)));
  const reservationStats = await db.select({ status: reservations.status, total: count() }).from(reservations).groupBy(reservations.status);
  const todayReservations = await db.select({ total: count() }).from(reservations).where(and(gte(reservations.startsAt, todayStart), lt(reservations.startsAt, todayEnd)));
  const shuttlecockUsage = await db.select({ name: matches.shuttlecockName, games: count() }).from(matches).where(completedFilter).groupBy(matches.shuttlecockName).orderBy(desc(count()));
  const topPlayers = await db.select({ id: players.id, name: players.name, gamesPlayed: players.timesPlayed, totalBillCentavos: players.totalBillCentavos }).from(players).orderBy(desc(players.timesPlayed), players.name).limit(10);
  const reservationCounts = Object.fromEntries(reservationStats.map((row) => [row.status, row.total]));
  const [pendingBilling] = await db.select({ total: sql<number>`coalesce(sum(case when ${gameBillings.paymentStatus} != 'paid' then ${gameBillings.totalDueCentavos} else 0 end), 0)`, records: sql<number>`coalesce(sum(case when ${gameBillings.paymentStatus} != 'paid' then 1 else 0 end), 0)` }).from(gameBillings).where(cutoff ? gt(gameBillings.updatedAt, cutoff) : undefined);
  const [manualPayments] = await db.select({ total: sql<number>`coalesce(sum(${playerPayments.amountCentavos}), 0)` }).from(playerPayments).where(cutoff ? gt(playerPayments.createdAt, cutoff) : undefined);
  const [manualCharges] = await db.select({ total: sql<number>`coalesce(sum(${playerCharges.amountCentavos}), 0)` }).from(playerCharges).where(cutoff ? gt(playerCharges.createdAt, cutoff) : undefined);
  return Response.json({
    totalGames: totals.totalGames,
    totalRevenueCentavos: totals.totalRevenueCentavos,
    todayRevenueCentavos: totals.todayRevenueCentavos,
    gamesToday: totals.gamesToday,
    gamesThisMonth: totals.gamesThisMonth,
    monthlyRevenueCentavos: totals.monthlyRevenueCentavos,
    totalActivePlayers: activePlayers.total,
    topPlayers: topPlayers.map((player) => ({ ...player, name: normalizePlayerName(player.name) })),
    shuttlecockUsage,
    reservations: { total: reservationStats.reduce((sum, row) => sum + row.total, 0), today: todayReservations[0]?.total ?? 0, completed: reservationCounts.completed ?? 0, cancelled: reservationCounts.cancelled ?? 0, noShow: reservationCounts.no_show ?? 0 },
    mostActivePlayer: mostActivePlayer ? { ...mostActivePlayer, name: normalizePlayerName(mostActivePlayer.name) } : null,
    mostUsedShuttlecock: mostUsedShuttlecock ?? null,
    pendingPaymentsCentavos: Math.max(0, pendingBilling.total + manualCharges.total - manualPayments.total),
    pendingPaymentRecords: pendingBilling.records,
  });
}
