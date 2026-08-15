import { and, desc, eq } from "drizzle-orm";
import { ensureTables, getDb } from "../../../db";
import { activeGamePlayers, activeGames, activityLogs, gameBillings } from "../../../db/schema";
import { cleanText, normalizePlayerName } from "../../../lib/domain";
import { getChatGPTUser, requireApiStaff } from "../../chatgpt-auth";

type ChargeInput = { id?: unknown; description?: unknown; amountCentavos?: unknown };
type BillingInput = { playerId?: unknown; betAmountCentavos?: unknown; shuttlecockContributionCentavos?: unknown; shuttlecockPayer?: unknown; additionalCharges?: ChargeInput[]; notes?: unknown; paymentStatus?: unknown; winner?: unknown };

const money = (value: unknown) => Math.max(0, Math.min(100_000_000, Math.round(Number(value) || 0)));

export async function GET(request: Request) {
  const denied = await requireApiStaff();
  if (denied) return denied;
  await ensureTables();
  const db = getDb();
  const url = new URL(request.url);
  const gameId = cleanText(url.searchParams.get("gameId"), 80);
  const playerId = cleanText(url.searchParams.get("playerId"), 80);
  if (!gameId && !playerId) return Response.json({ error: "Game or player is required" }, { status: 400 });
  const rows = await db.select().from(gameBillings).where(gameId ? eq(gameBillings.gameId, gameId) : eq(gameBillings.playerId, playerId)).orderBy(desc(gameBillings.updatedAt)).limit(500);
  return Response.json(rows.map((row) => ({ ...row, playerName: normalizePlayerName(row.playerName), additionalCharges: JSON.parse(row.additionalCharges || "[]") })));
}

export async function PUT(request: Request) {
  const denied = await requireApiStaff();
  if (denied) return denied;
  await ensureTables();
  const body = await request.json() as { gameId?: unknown; rows?: BillingInput[] };
  const gameId = cleanText(body.gameId, 80);
  if (!gameId || !Array.isArray(body.rows)) return Response.json({ error: "Game and billing rows are required" }, { status: 400 });
  const db = getDb();
  const [game] = await db.select({ id: activeGames.id, courtId: activeGames.courtId }).from(activeGames).where(eq(activeGames.id, gameId)).limit(1);
  if (!game) return Response.json({ error: "Active game not found" }, { status: 404 });
  const livePlayers = await db.select().from(activeGamePlayers).where(eq(activeGamePlayers.gameId, gameId));
  const playerMap = new Map(livePlayers.map((player) => [player.playerId, player]));
  const normalized = body.rows.map((row) => {
    const playerId = cleanText(row.playerId, 80);
    const player = playerMap.get(playerId);
    const additionalCharges = Array.isArray(row.additionalCharges) ? row.additionalCharges.map((charge) => ({ id: cleanText(charge.id, 80) || crypto.randomUUID(), description: cleanText(charge.description, 100) || "Additional charge", amountCentavos: money(charge.amountCentavos) })) : [];
    const additionalTotalCentavos = additionalCharges.reduce((sum, charge) => sum + charge.amountCentavos, 0);
    const betAmountCentavos = money(row.betAmountCentavos);
    const shuttlecockContributionCentavos = money(row.shuttlecockContributionCentavos);
    return { playerId, playerName: normalizePlayerName(player?.playerName), betAmountCentavos, shuttlecockContributionCentavos, shuttlecockPayer: row.shuttlecockPayer === true, additionalCharges, additionalTotalCentavos, totalDueCentavos: betAmountCentavos + shuttlecockContributionCentavos + additionalTotalCentavos, paymentStatus: ["unpaid", "partial", "paid"].includes(String(row.paymentStatus)) ? String(row.paymentStatus) : "unpaid", winner: row.winner === true, notes: cleanText(row.notes, 500) || null };
  });
  if (normalized.length !== livePlayers.length || normalized.some((row) => !row.playerName) || new Set(normalized.map((row) => row.playerId)).size !== livePlayers.length) return Response.json({ error: "Billing must include every current court player exactly once" }, { status: 400 });
  const now = Date.now();
  const user = await getChatGPTUser();
  const total = normalized.reduce((sum, row) => sum + row.totalDueCentavos, 0);
  await db.batch([
    db.delete(gameBillings).where(and(eq(gameBillings.gameId, gameId), eq(gameBillings.status, "active"))),
    ...normalized.map((row) => db.insert(gameBillings).values({ ...row, gameId, additionalCharges: JSON.stringify(row.additionalCharges), status: "active", updatedAt: now })),
    db.insert(activityLogs).values({ id: crypto.randomUUID(), type: "billing_updated", courtId: game.courtId, gameId, details: JSON.stringify({ totalCentavos: total, players: normalized.length }), managedBy: user?.displayName ?? null, createdAt: now }),
  ] as never);
  return Response.json({ ok: true, totalDueCentavos: total });
}
