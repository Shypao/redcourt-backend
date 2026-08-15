import { and, desc, eq, gt } from "drizzle-orm";
import { ensureTables, getDb } from "../../../db";
import { activityLogs, gameBillings, matchPlayers, matches, playerCharges, playerPayments, players } from "../../../db/schema";
import { cleanText, normalizePlayerName } from "../../../lib/domain";
import { currentDayCutoff } from "../../../lib/day-session";
import { getChatGPTUser, requireApiStaff } from "../../chatgpt-auth";

const TYPES = ["court_fee", "shuttlecock", "betting", "additional", "manual"] as const;
const money = (value: unknown) => Math.max(0, Math.min(100_000_000, Math.round(Number(value) || 0)));
const parseCharges = (value: string) => { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; } };

export async function GET(request: Request) {
  const denied = await requireApiStaff();
  if (denied) return denied;
  await ensureTables();
  const playerId = cleanText(new URL(request.url).searchParams.get("playerId"), 80);
  if (!playerId) return Response.json({ error: "Player is required" }, { status: 400 });
  const db = getDb();
  const [player] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  if (!player) return Response.json({ error: "Player not found" }, { status: 404 });
  const cutoff = await currentDayCutoff(db);
  const [custom, matchCosts, bills, paymentRows, gameRows] = await Promise.all([
    db.select().from(playerCharges).where(and(eq(playerCharges.playerId, playerId), gt(playerCharges.createdAt, cutoff))).orderBy(desc(playerCharges.createdAt)),
    db.select({ matchId: matchPlayers.matchId, amountCentavos: matchPlayers.costCentavos, createdAt: matches.endedAt, shuttlecockName: matches.shuttlecockName }).from(matchPlayers).innerJoin(matches, eq(matchPlayers.matchId, matches.id)).where(and(eq(matchPlayers.playerId, playerId), gt(matches.endedAt, cutoff))),
    db.select().from(gameBillings).where(and(eq(gameBillings.playerId, playerId), gt(gameBillings.updatedAt, cutoff))).orderBy(desc(gameBillings.updatedAt)),
    db.select().from(playerPayments).where(and(eq(playerPayments.playerId, playerId), gt(playerPayments.createdAt, cutoff))).orderBy(desc(playerPayments.createdAt)),
    db.select({ id: matches.id, courtId: matches.courtId, courtName: matches.courtName, playerNames: matches.playerNames, startedAt: matches.startedAt, endedAt: matches.endedAt, shuttlecockName: matches.shuttlecockName, winnerName: matches.winnerName, matchNotes: matches.matchNotes, won: matchPlayers.winner, costCentavos: matchPlayers.costCentavos }).from(matchPlayers).innerJoin(matches, eq(matchPlayers.matchId, matches.id)).where(eq(matchPlayers.playerId, playerId)).orderBy(desc(matches.endedAt)).limit(50),
  ]);
  const completedMatchIds = new Set(matchCosts.map((match) => match.matchId));
  const billMap = new Map(bills.map((bill) => [bill.gameId, bill]));
  const legacyCharges = matchCosts.flatMap((match) => {
    const bill = billMap.get(match.matchId);
    if (!bill) return [{ id: `match-${match.matchId}`, type: "shuttlecock", description: `${match.shuttlecockName} — match charge`, amountCentavos: match.amountCentavos, dateAdded: match.createdAt, addedBy: "Match billing", editable: false }];
    const extra = parseCharges(bill.additionalCharges).map((charge: { id?: string; description?: string; amountCentavos?: number }, index: number) => ({ id: `game-${match.matchId}-${charge.id || index}`, type: "additional", description: charge.description || "Additional charge", amountCentavos: money(charge.amountCentavos), dateAdded: bill.updatedAt, addedBy: "Match billing", editable: false }));
    const known = bill.betAmountCentavos + bill.shuttlecockContributionCentavos + extra.reduce((sum: number, charge: { amountCentavos: number }) => sum + charge.amountCentavos, 0);
    const rows = [
      ...(bill.shuttlecockContributionCentavos ? [{ id: `shuttle-${match.matchId}`, type: "shuttlecock", description: `${match.shuttlecockName} contribution`, amountCentavos: bill.shuttlecockContributionCentavos, dateAdded: bill.updatedAt, addedBy: "Match billing", editable: false }] : []),
      ...(bill.betAmountCentavos ? [{ id: `bet-${match.matchId}`, type: "betting", description: "Match betting charge", amountCentavos: bill.betAmountCentavos, dateAdded: bill.updatedAt, addedBy: "Match billing", editable: false }] : []),
      ...extra,
      ...(match.amountCentavos > known ? [{ id: `court-${match.matchId}`, type: "court_fee", description: "Court fee", amountCentavos: match.amountCentavos - known, dateAdded: match.createdAt, addedBy: "Match billing", editable: false }] : []),
    ];
    return rows;
  });
  const charges = [...custom.map((charge) => ({ id: charge.id, type: charge.type, description: charge.description, amountCentavos: charge.amountCentavos, dateAdded: charge.createdAt, addedBy: charge.addedBy || "Front desk", editable: true })), ...legacyCharges].sort((a, b) => b.dateAdded - a.dateAdded);
  const paidThroughGames = bills.filter((bill) => completedMatchIds.has(bill.gameId) && bill.paymentStatus === "paid").map((bill) => ({ id: `paid-${bill.gameId}`, amountCentavos: bill.totalDueCentavos, notes: "Paid during match billing", date: bill.updatedAt, addedBy: "Match billing" }));
  const payments = [...paymentRows.map((payment) => ({ id: payment.id, amountCentavos: payment.amountCentavos, notes: payment.notes, date: payment.createdAt, addedBy: payment.addedBy || "Front desk" })), ...paidThroughGames].sort((a, b) => a.date - b.date);
  const totalBillCentavos = charges.reduce((sum, charge) => sum + charge.amountCentavos, 0);
  const totalPaymentsCentavos = payments.reduce((sum, payment) => sum + payment.amountCentavos, 0);
  let paidRunning = 0;
  const paymentHistory = payments.map((payment) => { paidRunning += payment.amountCentavos; return { ...payment, remainingBalanceCentavos: Math.max(0, totalBillCentavos - paidRunning) }; }).reverse();
  const byType = Object.fromEntries(TYPES.map((type) => [type, charges.filter((charge) => charge.type === type).reduce((sum, charge) => sum + charge.amountCentavos, 0)]));
  const gameHistory = gameRows.map((game) => ({
    ...game,
    playerNames: parseCharges(game.playerNames).filter((name): name is string => typeof name === "string").map(normalizePlayerName),
    winnerName: game.winnerName ? normalizePlayerName(game.winnerName) : null,
  }));
  return Response.json({ player: { id: player.id, name: normalizePlayerName(player.name), gender: player.gender, level: player.level }, period: { startsAfter: cutoff, label: "Today's account" }, charges, payments: paymentHistory, gameHistory, summary: { totalBillCentavos, totalPaymentsCentavos, outstandingBalanceCentavos: Math.max(0, totalBillCentavos - totalPaymentsCentavos), remainingBalanceCentavos: Math.max(0, totalBillCentavos - totalPaymentsCentavos), courtFeesCentavos: byType.court_fee, shuttlecockChargesCentavos: byType.shuttlecock, bettingChargesCentavos: byType.betting, additionalChargesCentavos: byType.additional, manualChargesCentavos: byType.manual } });
}

export async function POST(request: Request) {
  const denied = await requireApiStaff();
  if (denied) return denied;
  await ensureTables();
  const body = await request.json() as { action?: unknown; playerId?: unknown; type?: unknown; description?: unknown; amountCentavos?: unknown; notes?: unknown };
  const action = cleanText(body.action, 30);
  const playerId = cleanText(body.playerId, 80);
  const amountCentavos = money(body.amountCentavos);
  if (!playerId || amountCentavos < 1) return Response.json({ error: "Player and amount are required" }, { status: 400 });
  const db = getDb(); const [player] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  if (!player) return Response.json({ error: "Player not found" }, { status: 404 });
  const now = Date.now(); const user = await getChatGPTUser(); const addedBy = user?.displayName || "Front desk";
  if (action === "add_payment") {
    await db.batch([db.insert(playerPayments).values({ id: crypto.randomUUID(), playerId, amountCentavos, method: "cash", notes: cleanText(body.notes, 300) || null, addedBy, createdAt: now }), db.insert(activityLogs).values({ id: crypto.randomUUID(), type: "payment_recorded", playerId, playerName: player.name, details: JSON.stringify({ amountCentavos, notes: cleanText(body.notes, 300) || null }), managedBy: addedBy, createdAt: now })]);
    return Response.json({ ok: true }, { status: 201 });
  }
  const type = cleanText(body.type, 30);
  if (action !== "add_charge" || !TYPES.includes(type as typeof TYPES[number])) return Response.json({ error: "Select a valid charge type" }, { status: 400 });
  const description = cleanText(body.description, 120) || type.replaceAll("_", " ");
  await db.batch([db.insert(playerCharges).values({ id: crypto.randomUUID(), playerId, type, description, amountCentavos, addedBy, createdAt: now, updatedAt: now }), db.insert(activityLogs).values({ id: crypto.randomUUID(), type: "player_charge_added", playerId, playerName: player.name, details: JSON.stringify({ chargeType: type, description, amountCentavos }), managedBy: addedBy, createdAt: now })]);
  return Response.json({ ok: true }, { status: 201 });
}

export async function PATCH(request: Request) {
  const denied = await requireApiStaff();
  if (denied) return denied;
  await ensureTables(); const body = await request.json() as { id?: unknown; description?: unknown; amountCentavos?: unknown; type?: unknown };
  const id = cleanText(body.id, 80); const amountCentavos = money(body.amountCentavos); const type = cleanText(body.type, 30); const description = cleanText(body.description, 120);
  if (!id || !description || amountCentavos < 1 || !TYPES.includes(type as typeof TYPES[number])) return Response.json({ error: "Complete every charge field" }, { status: 400 });
  const db = getDb(); const [charge] = await db.select().from(playerCharges).where(eq(playerCharges.id, id)).limit(1); if (!charge) return Response.json({ error: "Charge not found" }, { status: 404 });
  const [player] = await db.select().from(players).where(eq(players.id, charge.playerId)).limit(1); const now = Date.now(); const user = await getChatGPTUser();
  await db.batch([db.update(playerCharges).set({ type, description, amountCentavos, updatedAt: now }).where(eq(playerCharges.id, id)), db.insert(activityLogs).values({ id: crypto.randomUUID(), type: "player_charge_updated", playerId: charge.playerId, playerName: player?.name || null, details: JSON.stringify({ description, amountCentavos }), managedBy: user?.displayName || "Front desk", createdAt: now })]);
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const denied = await requireApiStaff();
  if (denied) return denied;
  await ensureTables(); const id = cleanText(new URL(request.url).searchParams.get("id"), 80); if (!id) return Response.json({ error: "Charge is required" }, { status: 400 });
  const db = getDb(); const [charge] = await db.select().from(playerCharges).where(eq(playerCharges.id, id)).limit(1); if (!charge) return Response.json({ error: "Charge not found" }, { status: 404 });
  const [player] = await db.select().from(players).where(eq(players.id, charge.playerId)).limit(1); const now = Date.now(); const user = await getChatGPTUser();
  await db.batch([db.delete(playerCharges).where(eq(playerCharges.id, id)), db.insert(activityLogs).values({ id: crypto.randomUUID(), type: "player_charge_removed", playerId: charge.playerId, playerName: player?.name || null, details: JSON.stringify({ description: charge.description, amountCentavos: charge.amountCentavos }), managedBy: user?.displayName || "Front desk", createdAt: now })]);
  return Response.json({ ok: true });
}
