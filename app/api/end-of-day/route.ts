import { and, count, eq, gt, inArray, sql } from "drizzle-orm";
import { ensureTables, getDb } from "../../../db";
import { activeGames, activityLogs, matches, playerCharges, playerPayments, players, queueEntries } from "../../../db/schema";
import { currentDayCutoff } from "../../../lib/day-session";
import { getChatGPTUser, requireApiStaff } from "../../chatgpt-auth";

export async function POST() {
  const denied = await requireApiStaff();
  if (denied) return denied;
  await ensureTables();
  const db = getDb();
  const [active] = await db.select({ total: count() }).from(activeGames);
  if (active.total > 0) return Response.json({ error: "Finish active matches before ending the day" }, { status: 409 });

  const cutoff = await currentDayCutoff(db);
  const [matchSummary, chargeSummary, paymentSummary] = await Promise.all([
    db.select({ games: count(), revenueCentavos: sql<number>`coalesce(sum(case when ${matches.billingTotalCentavos} > 0 then ${matches.billingTotalCentavos} else ${matches.shuttlecockPriceCentavos} end), 0)` }).from(matches).where(and(eq(matches.status, "completed"), gt(matches.endedAt, cutoff))),
    db.select({ totalCentavos: sql<number>`coalesce(sum(${playerCharges.amountCentavos}), 0)` }).from(playerCharges).where(gt(playerCharges.createdAt, cutoff)),
    db.select({ totalCentavos: sql<number>`coalesce(sum(${playerPayments.amountCentavos}), 0)` }).from(playerPayments).where(gt(playerPayments.createdAt, cutoff)),
  ]);
  const now = Date.now();
  const user = await getChatGPTUser();
  await db.batch([
    db.update(queueEntries).set({ status: "removed", standbyTableNumber: null, updatedAt: now }).where(inArray(queueEntries.status, ["waiting", "standby", "playing"])),
    db.delete(players),
    db.insert(activityLogs).values({
      id: crypto.randomUUID(),
      type: "day_ended",
      details: JSON.stringify({ games: matchSummary[0]?.games ?? 0, revenueCentavos: matchSummary[0]?.revenueCentavos ?? 0, manualChargesCentavos: chargeSummary[0]?.totalCentavos ?? 0, paymentsCentavos: paymentSummary[0]?.totalCentavos ?? 0 }),
      managedBy: user?.displayName ?? null,
      createdAt: now,
    }),
  ] as never);
  return Response.json({ ok: true, archivedGames: matchSummary[0]?.games ?? 0, closedAt: now });
}
