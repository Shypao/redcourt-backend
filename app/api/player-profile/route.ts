import { and, desc, eq, gt } from "drizzle-orm";
import { ensureTables, getDb } from "../../../db";
import { activeGamePlayers, activeGames, activityLogs, gameBillings, matchPlayers, matches, playerCharges, playerPayments, players, queueEntries } from "../../../db/schema";
import { cleanText, normalizePlayerName } from "../../../lib/domain";
import { currentDayCutoff } from "../../../lib/day-session";
import { requireApiStaff } from "../../chatgpt-auth";

const money = (value: unknown) => Math.max(0, Math.min(100_000_000, Math.round(Number(value) || 0)));

async function buildProfiles(cutoff: number) {
  const db = getDb();
  const [playerRows, matchRows, billingRows, payments, customCharges] = await Promise.all([
    db.select().from(players),
    db.select({ playerId: matchPlayers.playerId, playerName: matchPlayers.playerName, matchId: matches.id, startedAt: matches.startedAt, endedAt: matches.endedAt, winnerName: matches.winnerName, winner: matchPlayers.winner, revenueCentavos: matchPlayers.costCentavos }).from(matchPlayers).innerJoin(matches, eq(matchPlayers.matchId, matches.id)).where(and(eq(matches.status, "completed"), gt(matches.endedAt, cutoff))),
    db.select().from(gameBillings).where(gt(gameBillings.updatedAt, cutoff)),
    db.select().from(playerPayments).where(gt(playerPayments.createdAt, cutoff)),
    db.select().from(playerCharges).where(gt(playerCharges.createdAt, cutoff)),
  ]);
  return playerRows.map((player) => {
    const games = matchRows.filter((row) => row.playerId === player.id);
    const bills = billingRows.filter((row) => row.playerId === player.id && row.status === "completed");
    const playerPaymentsTotal = payments.filter((row) => row.playerId === player.id).reduce((sum, row) => sum + row.amountCentavos, 0);
    const wins = games.filter((game) => game.winner || game.winnerName?.split(" & ").some((name) => name.toLowerCase() === game.playerName.toLowerCase())).length;
    const revenue = games.reduce((sum, game) => sum + game.revenueCentavos, 0);
    const shuttle = bills.reduce((sum, bill) => sum + bill.shuttlecockContributionCentavos, 0);
    const betting = bills.reduce((sum, bill) => sum + bill.betAmountCentavos, 0);
    const custom = customCharges.filter((charge) => charge.playerId === player.id);
    const customTotal = custom.reduce((sum, charge) => sum + charge.amountCentavos, 0);
    const manual = custom.filter((charge) => charge.type === "manual").reduce((sum, charge) => sum + charge.amountCentavos, 0);
    const settledThroughBilling = bills.filter((bill) => bill.paymentStatus === "paid").reduce((sum, bill) => sum + bill.totalDueCentavos, 0);
    const totalPayments = playerPaymentsTotal + settledThroughBilling;
    const totalBill = revenue + customTotal;
    return { ...player, name: normalizePlayerName(player.name), gamesPlayed: games.length, wins, losses: Math.max(0, games.length - wins), winRate: games.length ? Math.round(wins / games.length * 1000) / 10 : 0, hoursPlayed: Math.round(games.reduce((sum, game) => sum + Math.max(0, game.endedAt - game.startedAt), 0) / 3_600_000 * 10) / 10, revenueCentavos: revenue + customTotal, shuttlecockExpensesCentavos: shuttle, bettingCentavos: betting, manualChargesCentavos: manual, totalContributionsCentavos: totalBill, totalBillCentavos: totalBill, totalPaymentsCentavos: totalPayments, outstandingBalanceCentavos: Math.max(0, totalBill - totalPayments), lastMatchPlayed: games.sort((a, b) => b.endedAt - a.endedAt)[0]?.endedAt ?? null };
  });
}

export async function GET(request: Request) {
  const denied = await requireApiStaff();
  if (denied) return denied;
  await ensureTables();
  const db = getDb();
  const id = cleanText(new URL(request.url).searchParams.get("id"), 80);
  if (!id) return Response.json({ error: "Player is required" }, { status: 400 });
  const cutoff = await currentDayCutoff(db);
  const profiles = await buildProfiles(cutoff);
  const profile = profiles.find((player) => player.id === id);
  if (!profile) return Response.json({ error: "Player not found" }, { status: 404 });
  const [queue, live, history, billingHistory, payments] = await Promise.all([
    db.select().from(queueEntries).where(eq(queueEntries.playerId, id)).limit(1),
    db.select({ courtId: activeGames.courtId }).from(activeGamePlayers).innerJoin(activeGames, eq(activeGamePlayers.gameId, activeGames.id)).where(eq(activeGamePlayers.playerId, id)).limit(1),
    db.select({ id: matches.id, startedAt: matches.startedAt, endedAt: matches.endedAt, courtId: matches.courtId, winnerName: matches.winnerName, revenueCentavos: matchPlayers.costCentavos }).from(matchPlayers).innerJoin(matches, eq(matchPlayers.matchId, matches.id)).where(and(eq(matchPlayers.playerId, id), eq(matches.status, "completed"), gt(matches.endedAt, cutoff))).orderBy(desc(matches.endedAt)).limit(200),
    db.select().from(gameBillings).where(and(eq(gameBillings.playerId, id), gt(gameBillings.updatedAt, cutoff))).orderBy(desc(gameBillings.updatedAt)).limit(200),
    db.select().from(playerPayments).where(and(eq(playerPayments.playerId, id), gt(playerPayments.createdAt, cutoff))).orderBy(desc(playerPayments.createdAt)).limit(200),
  ]);
  const ranked = (key: "gamesPlayed" | "winRate" | "revenueCentavos" | "hoursPlayed") => [...profiles].sort((a, b) => Number(b[key]) - Number(a[key]) || a.name.localeCompare(b.name)).findIndex((player) => player.id === id) + 1;
  const overall = [...profiles].sort((a, b) => (b.gamesPlayed * 10 + b.wins * 5 + b.revenueCentavos / 10_000) - (a.gamesPlayed * 10 + a.wins * 5 + a.revenueCentavos / 10_000) || a.name.localeCompare(b.name)).findIndex((player) => player.id === id) + 1;
  const hasDailyActivity = profile.gamesPlayed > 0 || profile.revenueCentavos > 0;
  return Response.json({ ...profile, queueStatus: ["waiting", "standby", "playing"].includes(queue[0]?.status ?? "") ? queue[0]!.status : "not queued", standbyStatus: queue[0]?.status === "standby" ? `Table ${queue[0].standbyTableNumber}` : "Not on standby", currentCourt: live[0]?.courtId ?? null, dayStartedAfter: cutoff, rankings: hasDailyActivity ? { overall, games: ranked("gamesPlayed"), winRate: ranked("winRate"), revenue: ranked("revenueCentavos") } : { overall: 0, games: 0, winRate: 0, revenue: 0 }, charts: { wins: profile.wins, losses: profile.losses }, history: history.map((match) => ({ ...match, winnerName: match.winnerName ? normalizePlayerName(match.winnerName) : null })), billingHistory: billingHistory.map((row) => ({ ...row, playerName: normalizePlayerName(row.playerName), additionalCharges: JSON.parse(row.additionalCharges || "[]") })), payments });
}

export async function POST(request: Request) {
  const denied = await requireApiStaff();
  if (denied) return denied;
  await ensureTables();
  const body = await request.json() as { playerId?: unknown; amountCentavos?: unknown; method?: unknown; notes?: unknown };
  const playerId = cleanText(body.playerId, 80);
  const amountCentavos = money(body.amountCentavos);
  if (!playerId || amountCentavos < 1) return Response.json({ error: "Player and payment amount are required" }, { status: 400 });
  const db = getDb();
  const [player] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  if (!player) return Response.json({ error: "Player not found" }, { status: 404 });
  const now = Date.now();
  await db.batch([
    db.insert(playerPayments).values({ id: crypto.randomUUID(), playerId, amountCentavos, method: cleanText(body.method, 30) || "cash", notes: cleanText(body.notes, 300) || null, createdAt: now }),
    db.insert(activityLogs).values({ id: crypto.randomUUID(), type: "payment_recorded", playerId, playerName: player.name, details: JSON.stringify({ amountCentavos, method: cleanText(body.method, 30) || "cash" }), createdAt: now }),
  ]);
  return Response.json({ ok: true }, { status: 201 });
}
