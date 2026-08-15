export const SHUTTLECOCKS = {
  "ling-mei-60": { id: "ling-mei-60", name: "Ling Mei 60", priceCentavos: 18_000 },
  "ling-mei-10": { id: "ling-mei-10", name: "Ling Mei 10", priceCentavos: 3_500 },
} as const;

export type ShuttlecockId = keyof typeof SHUTTLECOCKS;

export function isShuttlecockId(value: unknown): value is ShuttlecockId {
  return typeof value === "string" && value in SHUTTLECOCKS;
}

// Walk-ins can start a game without picking a shuttlecock brand up front.
// This sentinel keeps billing math well-defined (price 0) until one is chosen.
export const NO_SHUTTLECOCK = { id: "none", name: "No shuttlecock", priceCentavos: 0 } as const;

// Ling Mei 10 is billed at ₱35 for every player. Other supported brands keep
// their per-game price, which is divided fairly between the players.
export function shuttlecockTotalPriceCentavos(
  shuttlecockId: ShuttlecockId | typeof NO_SHUTTLECOCK.id,
  playerCount: number,
): number {
  if (!Number.isInteger(playerCount) || playerCount < 1) {
    throw new Error("Player count must be a positive integer");
  }
  if (shuttlecockId === NO_SHUTTLECOCK.id) return 0;
  const shuttlecock = SHUTTLECOCKS[shuttlecockId];
  return shuttlecockId === "ling-mei-10"
    ? shuttlecock.priceCentavos * playerCount
    : shuttlecock.priceCentavos;
}

export function calculatePlayerCharges(
  priceCentavos: number,
  playerCount: number,
): number[] {
  if (!Number.isInteger(priceCentavos) || priceCentavos < 0) {
    throw new Error("Shuttlecock price must be a non-negative integer");
  }
  if (!Number.isInteger(playerCount) || playerCount < 1) {
    throw new Error("Player count must be a positive integer");
  }

  const baseCharge = Math.floor(priceCentavos / playerCount);
  const remainder = priceCentavos % playerCount;
  return Array.from(
    { length: playerCount },
    (_, index) => baseCharge + (index < remainder ? 1 : 0),
  );
}

export function formatPeso(centavos: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: centavos % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(centavos / 100);
}
