export const RESERVATION_STATUSES = [
  "pending",
  "confirmed",
  "checked_in",
  "playing",
  "completed",
  "cancelled",
  "no_show",
] as const;

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export function isReservationStatus(value: unknown): value is ReservationStatus {
  return typeof value === "string" && RESERVATION_STATUSES.includes(value as ReservationStatus);
}

export function parseJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function cleanText(value: unknown, maxLength = 120): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

/** Canonical player-name form used for storage, comparison, and display. */
export function normalizePlayerName(value: unknown, maxLength = 120): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").toUpperCase().slice(0, maxLength);
}

export function duplicatePlayerNameMessage(name: string): string {
  return `Player "${normalizePlayerName(name)}" already exists. Please use a different name.`;
}

export function isPlayerNameUniqueConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("players.normalized_name") || message.includes("players_normalized_name_unique");
}

export function integerParam(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}
