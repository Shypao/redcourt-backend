import { and, eq, gt, lt, or } from "drizzle-orm";
import { ensureTables, getDb } from "../../../../db";
import { players, reservationPlayers, reservations } from "../../../../db/schema";
import { calculateReservationFeeCentavos } from "../../../../lib/reservations";
import { normalizePlayerName } from "../../../../lib/domain";
import { findPlayerNameConflict } from "../../../../lib/player-names";
import { requireApiStaff } from "../../../chatgpt-auth";

const ACTIVE_STATUSES = ["pending", "confirmed", "checked_in", "playing"];
const runtimeEnv = process.env;

function parseCsv(csv: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (character === '"' && quoted && csv[index + 1] === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(cell); cell = "";
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else cell += character;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows[0].map((value) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""])));
}

function pick(row: Record<string, string>, ...names: string[]) {
  for (const name of names) if (row[name]) return row[name];
  return "";
}

function parseDateParts(value: string) {
  const iso = value.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  const local = value.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (local) return { year: Number(local[3]) < 100 ? 2000 + Number(local[3]) : Number(local[3]), month: Number(local[1]), day: Number(local[2]) };
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? { year: parsed.getFullYear(), month: parsed.getMonth() + 1, day: parsed.getDate() } : null;
}

function parseClock(value: string) {
  const match = value.trim().match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  return hour >= 0 && hour < 24 && minute >= 0 && minute < 60 ? { hour, minute } : null;
}

function manilaTimestamp(dateValue: string, timeValue: string) {
  const date = parseDateParts(dateValue);
  const time = parseClock(timeValue);
  return date && time ? Date.UTC(date.year, date.month - 1, date.day, time.hour - 8, time.minute) : NaN;
}

function moneyCentavos(value: string) {
  const amount = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : 0;
}

export async function GET() {
  const denied = await requireApiStaff();
  if (denied) return denied;
  return Response.json({
    configured: Boolean(runtimeEnv.GOOGLE_SHEETS_RESERVATIONS_CSV_URL),
    formUrl: runtimeEnv.GOOGLE_FORM_RESERVATION_URL ?? null,
  });
}

export async function POST() {
  const denied = await requireApiStaff();
  if (denied) return denied;
  await ensureTables();
  const sheetUrl = runtimeEnv.GOOGLE_SHEETS_RESERVATIONS_CSV_URL;
  if (!sheetUrl) return Response.json({ error: "Google Sheets sync is not configured. Add GOOGLE_SHEETS_RESERVATIONS_CSV_URL." }, { status: 503 });
  const response = await fetch(sheetUrl, { headers: { Accept: "text/csv" } });
  if (!response.ok) return Response.json({ error: "Google Sheets could not be reached" }, { status: 502 });
  const rows = parseCsv(await response.text());
  const db = getDb();
  let imported = 0;
  let skipped = 0;
  let conflicts = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const name = normalizePlayerName(pick(row, "customer name", "name", "full name"));
    const contact = pick(row, "contact number", "contact", "phone").slice(0, 80) || null;
    const dateValue = pick(row, "reservation date", "date");
    const timeRange = pick(row, "preferred time", "time", "reservation time");
    const explicitStart = pick(row, "start time", "starts at") || timeRange.split(/\s*[-–]\s*/)[0];
    const explicitEnd = pick(row, "end time", "ends at") || timeRange.split(/\s*[-–]\s*/)[1];
    const startsAt = manilaTimestamp(dateValue, explicitStart);
    const endsAt = explicitEnd ? manilaTimestamp(dateValue, explicitEnd) : startsAt + 60 * 60_000;
    const playerCount = Math.min(8, Math.max(1, Number(pick(row, "number of players", "players")) || 4));
    const courtMatch = pick(row, "preferred court", "court", "court number").match(/\d+/);
    const requestedCourtId = courtMatch ? Number(courtMatch[0]) : null;
    const timestamp = pick(row, "timestamp", "submitted at");
    const externalId = `${timestamp || dateValue}|${name}|${explicitStart}|${index + 2}`.slice(0, 160);
    if (!name || !Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) { skipped += 1; continue; }
    const [existing] = await db.select({ id: reservations.id }).from(reservations).where(and(eq(reservations.source, "google_sheets"), eq(reservations.externalId, externalId))).limit(1);
    if (existing) { skipped += 1; continue; }
    let courtId = requestedCourtId && requestedCourtId >= 1 && requestedCourtId <= 9 ? requestedCourtId : null;
    let conflictNote = "";
    if (courtId) {
      const overlap = await db.select({ id: reservations.id }).from(reservations).where(and(eq(reservations.courtId, courtId), lt(reservations.startsAt, endsAt), gt(reservations.endsAt, startsAt), or(...ACTIVE_STATUSES.map((status) => eq(reservations.status, status))))).limit(1);
      if (overlap.length) { conflictNote = `Scheduling conflict: requested Court ${courtId}. `; courtId = null; conflicts += 1; }
    }
    const id = crypto.randomUUID();
    const existingPlayer = await findPlayerNameConflict(db, name);
    const playerId = existingPlayer?.id ?? crypto.randomUUID();
    const now = Date.now();
    const fee = moneyCentavos(pick(row, "total fee", "amount")) || calculateReservationFeeCentavos(startsAt, endsAt);
    const notes = `${conflictNote}${pick(row, "notes", "remarks")}`.trim().slice(0, 500) || null;
    const statements = [
      ...(existingPlayer ? [] : [db.insert(players).values({ id: playerId, name, normalizedName: name, contact, createdAt: now, updatedAt: now })]),
      db.insert(reservations).values({ id, startsAt, endsAt, courtId, customerPlayerId: playerId, customerName: name, contact, playerCount, status: "pending", notes, paymentMethod: "unpaid", paymentStatus: "unpaid", totalFeeCentavos: fee, paidAmountCentavos: 0, source: "google_sheets", externalId, reservationType: "court", createdAt: now, updatedAt: now }),
      db.insert(reservationPlayers).values({ reservationId: id, playerId }),
    ];
    await db.batch(statements as never);
    imported += 1;
  }
  return Response.json({ ok: true, imported, skipped, conflicts });
}
