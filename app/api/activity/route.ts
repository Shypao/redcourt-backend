import { and, desc, eq, gte, like, lt, or } from "drizzle-orm";
import { ensureTables, getDb } from "../../../db";
import { activityLogs } from "../../../db/schema";
import { cleanText, integerParam, normalizePlayerName } from "../../../lib/domain";
import { activityDescription } from "../../../lib/activity";
import { requireApiStaff } from "../../chatgpt-auth";

export async function GET(request: Request) {
  const denied = await requireApiStaff();
  if (denied) return denied;
  await ensureTables();
  const db = getDb();
  const url = new URL(request.url);
  const filters = [];
  const from = integerParam(url.searchParams.get("from"));
  const to = integerParam(url.searchParams.get("to"));
  const courtId = integerParam(url.searchParams.get("courtId"));
  const gameId = cleanText(url.searchParams.get("gameId"), 80);
  const reservationId = cleanText(url.searchParams.get("reservationId"), 80);
  const type = cleanText(url.searchParams.get("type"), 50);
  const query = cleanText(url.searchParams.get("q"), 100);
  if (from) filters.push(gte(activityLogs.createdAt, from));
  if (to) filters.push(lt(activityLogs.createdAt, to));
  if (courtId) filters.push(eq(activityLogs.courtId, courtId));
  if (gameId) filters.push(eq(activityLogs.gameId, gameId));
  if (reservationId) filters.push(eq(activityLogs.reservationId, reservationId));
  if (type) filters.push(eq(activityLogs.type, type));
  if (query) filters.push(or(like(activityLogs.playerName, `%${query}%`), like(activityLogs.type, `%${query}%`), like(activityLogs.details, `%${query}%`))!);
  const limit = Math.min(integerParam(url.searchParams.get("limit")) ?? 300, 1000);
  const rows = await db.select().from(activityLogs).where(filters.length ? and(...filters) : undefined).orderBy(desc(activityLogs.createdAt)).limit(limit);
  return Response.json(rows.map((row) => {
    let details: Record<string, unknown> = {};
    try { const parsed = JSON.parse(row.details || "{}"); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) details = parsed; }
    catch { details = { note: "Legacy activity details could not be read" }; }
    for (const key of ["players", "incoming", "outgoing", "lineup"]) {
      if (Array.isArray(details[key])) details[key] = details[key].map((name) => normalizePlayerName(name));
    }
    if (typeof details.winner === "string") details.winner = normalizePlayerName(details.winner);
    const playerName = row.playerName ? normalizePlayerName(row.playerName) : null;
    return { ...row, playerName, details, description: activityDescription(row.type, details, playerName, row.courtId) };
  }));
}
