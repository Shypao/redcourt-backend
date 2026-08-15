export const DEFAULT_COURT_RATE_CENTAVOS_PER_HOUR = 20_000;

export const PAYMENT_METHODS = ["cash", "gcash", "bank", "unpaid"] as const;
export const PAYMENT_STATUSES = ["unpaid", "partial", "paid"] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && PAYMENT_METHODS.includes(value as PaymentMethod);
}

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === "string" && PAYMENT_STATUSES.includes(value as PaymentStatus);
}

export function reservationDurationMinutes(startsAt: number, endsAt: number) {
  return Math.max(0, Math.round((endsAt - startsAt) / 60_000));
}

export function calculateReservationFeeCentavos(startsAt: number, endsAt: number) {
  const halfHours = Math.max(1, Math.ceil(reservationDurationMinutes(startsAt, endsAt) / 30));
  return Math.round((DEFAULT_COURT_RATE_CENTAVOS_PER_HOUR / 2) * halfHours);
}
