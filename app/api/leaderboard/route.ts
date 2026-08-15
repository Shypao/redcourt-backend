import { ensureTables } from "../../../db";
import { getDb } from "../../../db";
import { gameBillings, matchPlayers, matches, playerCharges, players } from "../../../db/schema";
import { and, eq, gt } from "drizzle-orm";
import { currentDayCutoff } from "../../../lib/day-session";
import { normalizePlayerName } from "../../../lib/domain";
import { requireApiStaff } from "../../chatgpt-auth";

export async function GET(request: Request) {
  const denied = await requireApiStaff();
  if (denied) return denied;
  await ensureTables();
  const url = new URL(request.url);
  const db = getDb();
  const cutoff = await currentDayCutoff(db);
  const [playerRows, games, billings, customCharges] = await Promise.all([
    db.select().from(players),
    db.select({ playerId: matchPlayers.playerId, playerName: matchPlayers.playerName, winner: matchPlayers.winner, startedAt: matches.startedAt, endedAt: matches.endedAt, winnerName: matches.winnerName, revenueCentavos: matchPlayers.costCentavos }).from(matchPlayers).innerJoin(matches, eq(matchPlayers.matchId, matches.id)).where(and(eq(matches.status, "completed"), gt(matches.endedAt, cutoff))),
    db.select().from(gameBillings).where(gt(gameBillings.updatedAt, cutoff)),
    db.select().from(playerCharges).where(gt(playerCharges.createdAt, cutoff)),
  ]);
  const rows = playerRows.map((player) => { const played = games.filter((game) => game.playerId === player.id); const wins = played.filter((game) => game.winner || game.winnerName?.split(" & ").some((name) => name.toLowerCase() === game.playerName.toLowerCase())).length; const bills = billings.filter((bill) => bill.playerId === player.id && bill.status === "completed"); const custom = customCharges.filter((charge) => charge.playerId === player.id).reduce((sum, charge) => sum + charge.amountCentavos, 0); return { id: player.id, name: normalizePlayerName(player.name), gender: player.gender, level: player.level, gamesPlayed: played.length, wins, winRate: played.length ? Math.round(wins / played.length * 1000) / 10 : 0, revenueCentavos: played.reduce((sum, game) => sum + game.revenueCentavos, 0) + custom, hoursPlayed: Math.round(played.reduce((sum, game) => sum + Math.max(0, game.endedAt - game.startedAt), 0) / 3_600_000 * 10) / 10, contributionsCentavos: bills.reduce((sum, bill) => sum + bill.shuttlecockContributionCentavos + bill.additionalTotalCentavos, 0) + custom, lastPlayed: played.sort((a, b) => b.endedAt - a.endedAt)[0]?.endedAt ?? null }; });
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase(); const level = url.searchParams.get("level"); const gender = url.searchParams.get("gender");
  return Response.json(rows.filter((row) => (row.gamesPlayed > 0 || row.revenueCentavos > 0 || row.contributionsCentavos > 0) && (!q || row.name.toLowerCase().includes(q)) && (!level || row.level === level) && (!gender || row.gender === gender)));
}
