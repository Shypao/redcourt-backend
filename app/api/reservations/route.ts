import { and, asc, eq, gt, gte, like, lt, or } from "drizzle-orm";
import { ensureTables, getDb } from "../../../db";
import { activityLogs, courts, players, reservationPlayers, reservations } from "../../../db/schema";
import { cleanText, duplicatePlayerNameMessage, integerParam, isPlayerNameUniqueConstraintError, isReservationStatus, normalizePlayerName } from "../../../lib/domain";
import { findPlayerNameConflict } from "../../../lib/player-names";
import { manilaDayRange, rangeFromSearchParams } from "../../../lib/time";
import { calculateReservationFeeCentavos, isPaymentMethod, isPaymentStatus } from "../../../lib/reservations";
import { getChatGPTUser, requireApiStaff } from "../../chatgpt-auth";

const ACTIVE_STATUSES = ["pending", "confirmed", "checked_in", "playing"];

export async function GET(request: Request) {
  const denied = await requireApiStaff();
  if (denied) return denied;
  await ensureTables();
  const db = getDb();
  const url = new URL(request.url);
  const requestedRange = rangeFromSearchParams(url.searchParams);
  const [start, end] = requestedRange ?? manilaDayRange();
  const status = url.searchParams.get("status");
  const courtId = integerParam(url.searchParams.get("courtId"));
  const query = cleanText(url.searchParams.get("q"), 80).toLowerCase();
  const paymentStatus = url.searchParams.get("paymentStatus");
  const filters = [gte(reservations.startsAt, start), lt(reservations.startsAt, end)];
  if (status && isReservationStatus(status)) filters.push(eq(reservations.status, status));
  if (courtId) filters.push(eq(reservations.courtId, courtId));
  if (paymentStatus && isPaymentStatus(paymentStatus)) filters.push(eq(reservations.paymentStatus, paymentStatus));
  if (query) {
    const wildcard = `%${query}%`;
    filters.push(or(
      like(reservations.id, wildcard),
      like(reservations.customerName, wildcard),
      like(reservations.contact, wildcard),
    )!);
  }
  const limit = Math.min(integerParam(url.searchParams.get("limit")) ?? 500, 1000);
  const rows = await db.select().from(reservations).where(and(...filters)).orderBy(asc(reservations.startsAt)).limit(limit);
  return Response.json(rows.map((row) => ({ ...row, customerName: normalizePlayerName(row.customerName) })));
}

export async function POST(request: Request) {
  const denied = await requireApiStaff();
  if (denied) return denied;
  await ensureTables();
  const body = await request.json() as Record<string, unknown>;
  const name = normalizePlayerName(body.customerName);
  const contact = cleanText(body.contact, 80) || null;
  const startsAt = Number(body.startsAt);
  const endsAt = Number(body.endsAt);
  const courtId = body.courtId == null || body.courtId === "" ? null : Number(body.courtId);
  const playerCount = Number(body.playerCount);
  if (!name || !Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt || !Number.isInteger(playerCount) || playerCount < 1 || playerCount > 8 || (courtId !== null && (!Number.isInteger(courtId) || courtId < 1 || courtId > 9))) {
    return Response.json({ error: "Enter a valid customer, time, player count, and court" }, { status: 400 });
  }
  const db = getDb();
  if (courtId) {
    const [court] = await db.select({ maintenance: courts.maintenance }).from(courts).where(eq(courts.id, courtId)).limit(1);
    if (!court || court.maintenance) return Response.json({ error: "That court is closed for maintenance" }, { status: 409 });
    const conflicts = await db.select({ id: reservations.id }).from(reservations).where(and(
      eq(reservations.courtId, courtId), lt(reservations.startsAt, endsAt), gt(reservations.endsAt, startsAt),
      or(...ACTIVE_STATUSES.map((value) => eq(reservations.status, value))),
    )).limit(1);
    if (conflicts.length) return Response.json({ error: "That court already has an overlapping reservation" }, { status: 409 });
  }
  let playerId = cleanText(body.customerPlayerId, 80);
  const nameConflict = await findPlayerNameConflict(db, name, playerId || undefined);
  if (!playerId) {
    playerId = nameConflict?.id ?? crypto.randomUUID();
  } else if (nameConflict) {
    return Response.json({ error: duplicatePlayerNameMessage(name) }, { status: 409 });
  }
  const now = Date.now();
  const id = crypto.randomUUID();
  const user = await getChatGPTUser();
  const status = isReservationStatus(body.status) ? body.status : "pending";
  const paymentMethod = isPaymentMethod(body.paymentMethod) ? body.paymentMethod : "unpaid";
  const totalFeeCentavos = Number.isInteger(Number(body.totalFeeCentavos)) && Number(body.totalFeeCentavos) >= 0 ? Number(body.totalFeeCentavos) : calculateReservationFeeCentavos(startsAt, endsAt);
  let paidAmountCentavos = Number.isInteger(Number(body.paidAmountCentavos)) && Number(body.paidAmountCentavos) >= 0 ? Math.min(Number(body.paidAmountCentavos), totalFeeCentavos) : 0;
  const requestedPaymentStatus = isPaymentStatus(body.paymentStatus) ? body.paymentStatus : null;
  if (requestedPaymentStatus === "paid") paidAmountCentavos = totalFeeCentavos;
  const paymentStatus = paidAmountCentavos >= totalFeeCentavos && totalFeeCentavos > 0 ? "paid" : paidAmountCentavos > 0 ? "partial" : "unpaid";
  try {
    await db.batch([
    db.insert(players).values({ id: playerId, name, normalizedName: name, contact, createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: players.id, set: { name, normalizedName: name, contact, updatedAt: now } }),
    db.insert(reservations).values({ id, startsAt, endsAt, courtId, customerPlayerId: playerId, customerName: name, contact, playerCount, status, notes: cleanText(body.notes, 500) || null, reservationType: cleanText(body.reservationType, 40) || "court", paymentMethod, paymentStatus, totalFeeCentavos, paidAmountCentavos, source: cleanText(body.source, 30) || "manual", externalId: cleanText(body.externalId, 160) || null, createdAt: now, updatedAt: now }),
    db.insert(reservationPlayers).values({ reservationId: id, playerId }).onConflictDoNothing(),
    db.insert(activityLogs).values({ id: crypto.randomUUID(), type: "reservation_created", playerId, playerName: name, courtId, reservationId: id, details: JSON.stringify({ startsAt, endsAt, status, paymentStatus }), managedBy: user?.displayName ?? null, createdAt: now }),
    ]);
  } catch (error) {
    if (isPlayerNameUniqueConstraintError(error)) return Response.json({ error: duplicatePlayerNameMessage(name) }, { status: 409 });
    throw error;
  }
  return Response.json({ ok: true, id }, { status: 201 });
}

export async function PATCH(request: Request) {
  const denied = await requireApiStaff();
  if (denied) return denied;
  await ensureTables();
  const body = await request.json() as Record<string, unknown>;
  const id = cleanText(body.id, 80);
  if (!id) return Response.json({ error: "Reservation ID is required" }, { status: 400 });
  const db = getDb();
  const [current] = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
  if (!current) return Response.json({ error: "Reservation not found" }, { status: 404 });
  const status = body.status === undefined ? current.status : body.status;
  if (!isReservationStatus(status)) return Response.json({ error: "Invalid reservation status" }, { status: 400 });
  if (current.status === "completed" && status !== "completed") return Response.json({ error: "Completed reservations cannot be reopened" }, { status: 409 });
  const startsAt = body.startsAt === undefined ? current.startsAt : Number(body.startsAt);
  const endsAt = body.endsAt === undefined ? current.endsAt : Number(body.endsAt);
  const courtId = body.courtId === undefined ? current.courtId : body.courtId == null || body.courtId === "" ? null : Number(body.courtId);
  const playerCount = body.playerCount === undefined ? current.playerCount : Number(body.playerCount);
  const customerName = body.customerName === undefined ? normalizePlayerName(current.customerName) : normalizePlayerName(body.customerName);
  const contact = body.contact === undefined ? current.contact : cleanText(body.contact, 80) || null;
  const paymentMethod = body.paymentMethod === undefined ? current.paymentMethod : isPaymentMethod(body.paymentMethod) ? body.paymentMethod : null;
  const totalFeeCentavos = body.totalFeeCentavos === undefined ? current.totalFeeCentavos || calculateReservationFeeCentavos(startsAt, endsAt) : Number(body.totalFeeCentavos);
  let paidAmountCentavos = body.paidAmountCentavos === undefined ? current.paidAmountCentavos : Number(body.paidAmountCentavos);
  const requestedPaymentStatus = body.paymentStatus === undefined ? null : body.paymentStatus;
  if (requestedPaymentStatus === "paid") paidAmountCentavos = totalFeeCentavos;
  const paymentStatus = requestedPaymentStatus !== null && !isPaymentStatus(requestedPaymentStatus) ? null : paidAmountCentavos >= totalFeeCentavos && totalFeeCentavos > 0 ? "paid" : paidAmountCentavos > 0 ? "partial" : "unpaid";
  if (!customerName || !Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt || !Number.isInteger(playerCount) || playerCount < 1 || playerCount > 8 || (courtId !== null && (!Number.isInteger(courtId) || courtId < 1 || courtId > 9)) || !paymentMethod || !paymentStatus || !Number.isInteger(totalFeeCentavos) || totalFeeCentavos < 0 || !Number.isInteger(paidAmountCentavos) || paidAmountCentavos < 0 || paidAmountCentavos > totalFeeCentavos) {
    return Response.json({ error: "Invalid reservation update" }, { status: 400 });
  }
  if (await findPlayerNameConflict(db, customerName, current.customerPlayerId)) {
    return Response.json({ error: duplicatePlayerNameMessage(customerName) }, { status: 409 });
  }
  if (courtId && !["cancelled", "no_show", "completed"].includes(status)) {
    const [court] = await db.select({ maintenance: courts.maintenance }).from(courts).where(eq(courts.id, courtId)).limit(1);
    if (!court || court.maintenance) return Response.json({ error: "That court is closed for maintenance" }, { status: 409 });
    const conflicts = await db.select({ id: reservations.id }).from(reservations).where(and(
      eq(reservations.courtId, courtId), lt(reservations.startsAt, endsAt), gt(reservations.endsAt, startsAt),
      or(...ACTIVE_STATUSES.map((value) => eq(reservations.status, value))),
    )).limit(10);
    if (conflicts.some((conflict) => conflict.id !== id)) return Response.json({ error: "That court already has an overlapping reservation" }, { status: 409 });
  }
  const updatedAt = Date.now();
  const user = await getChatGPTUser();
  try {
    await db.batch([
    db.update(reservations).set({ startsAt, endsAt, courtId, playerCount, status, customerName, contact, notes: body.notes === undefined ? current.notes : cleanText(body.notes, 500) || null, reservationType: body.reservationType === undefined ? current.reservationType : cleanText(body.reservationType, 40) || "court", paymentMethod, paymentStatus, totalFeeCentavos, paidAmountCentavos, updatedAt }).where(eq(reservations.id, id)),
    db.update(players).set({ name: customerName, normalizedName: customerName, contact, updatedAt }).where(eq(players.id, current.customerPlayerId)),
    db.insert(activityLogs).values({ id: crypto.randomUUID(), type: "reservation_updated", playerId: current.customerPlayerId, playerName: customerName, courtId, reservationId: id, details: JSON.stringify({ previousStatus: current.status, status, startsAt, endsAt, paymentStatus }), managedBy: user?.displayName ?? null, createdAt: updatedAt }),
    ]);
  } catch (error) {
    if (isPlayerNameUniqueConstraintError(error)) return Response.json({ error: duplicatePlayerNameMessage(customerName) }, { status: 409 });
    throw error;
  }
  return Response.json({ ok: true });
}
