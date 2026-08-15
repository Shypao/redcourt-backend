const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

export function manilaDateParts(timestamp = Date.now()) {
  const shifted = new Date(timestamp + MANILA_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function manilaDayRange(timestamp = Date.now()): [number, number] {
  const { year, month, day } = manilaDateParts(timestamp);
  const start = Date.UTC(year, month - 1, day) - MANILA_OFFSET_MS;
  return [start, start + 24 * 60 * 60 * 1000];
}

export function manilaMonthRange(year: number, month: number): [number, number] {
  const start = Date.UTC(year, month - 1, 1) - MANILA_OFFSET_MS;
  const end = Date.UTC(year, month, 1) - MANILA_OFFSET_MS;
  return [start, end];
}

export function rangeFromSearchParams(params: URLSearchParams): [number, number] | null {
  const from = Number(params.get("from"));
  const to = Number(params.get("to"));
  if (Number.isFinite(from) && Number.isFinite(to) && from >= 0 && to > from) return [from, to];
  const year = Number(params.get("year"));
  const month = Number(params.get("month"));
  if (Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12) {
    return manilaMonthRange(year, month);
  }
  return null;
}
