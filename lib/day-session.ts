import { desc, eq } from "drizzle-orm";
import type { getDb } from "../db";
import { activityLogs } from "../db/schema";

export async function currentDayCutoff(db: ReturnType<typeof getDb>) {
  const [lastClose] = await db
    .select({ createdAt: activityLogs.createdAt })
    .from(activityLogs)
    .where(eq(activityLogs.type, "day_ended"))
    .orderBy(desc(activityLogs.createdAt))
    .limit(1);
  return lastClose?.createdAt ?? 0;
}
