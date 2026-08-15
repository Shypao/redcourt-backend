import { getDb, ensureTables } from "../../../db";
import { activeGamePlayers, activeGames, activityLogs, gameBillings, matchPlayers, matches, playerCharges, playerPayments, players, queueEntries, reservationPlayers, reservations } from "../../../db/schema";
import { requireApiStaff } from "../../chatgpt-auth";

const RESET_CONFIRMATION = "RESET REDCOURT";

export async function POST(request: Request) {
  const denied = await requireApiStaff({ admin: true });
  if (denied) return denied;
  const body = await request.json().catch(() => ({})) as { confirmation?: unknown };
  if (body.confirmation !== RESET_CONFIRMATION) {
    return Response.json({ error: `Type ${RESET_CONFIRMATION} to clear all RedCourt records.` }, { status: 400 });
  }
  await ensureTables();
  const db = getDb();
  await db.batch([
    db.delete(activeGamePlayers), db.delete(activeGames), db.delete(matchPlayers),
    db.delete(gameBillings), db.delete(playerCharges), db.delete(playerPayments), db.delete(activityLogs), db.delete(queueEntries), db.delete(matches), db.delete(reservationPlayers), db.delete(reservations), db.delete(players),
  ]);
  return Response.json({ ok: true });
}
