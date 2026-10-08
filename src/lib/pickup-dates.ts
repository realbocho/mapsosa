export type PickupDay = "수요일" | "토요일";

function seoulToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return new Date(Date.UTC(Number(value("year")), Number(value("month")) - 1, Number(value("day"))));
}

export function nextPickupDate(day: PickupDay) {
  const date = seoulToday();
  const weekday = day === "수요일" ? 3 : 6;
  let delta = (weekday - date.getUTCDay() + 7) % 7;
  if (delta === 0) delta = 7;
  date.setUTCDate(date.getUTCDate() + delta);
  const cutoff = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - 1, 1);
  if (Date.now() >= cutoff) date.setUTCDate(date.getUTCDate() + 7);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function formatPickupDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  const weekday = new Intl.DateTimeFormat("ko-KR", { weekday: "short", timeZone: "UTC" }).format(value);
  return `${month}월 ${day}일 (${weekday})`;
}

export function orderDeadlineTimestamp(pickupDate: string) {
  const [year, month, day] = pickupDate.split("-").map(Number);
  // Orders close at 10:00 KST on the day before pickup (01:00 UTC).
  return Date.UTC(year, month - 1, day - 1, 1);
}

function seoulTimestamp(date: string, hour: number) {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day, hour - 9);
}

export function slotConfirmationTimePassed(pickupDate: string) {
  const [year, month, day] = pickupDate.split("-").map(Number);
  const previousDay = new Date(Date.UTC(year, month - 1, day - 1));
  const cutoffDate = `${previousDay.getUTCFullYear()}-${String(previousDay.getUTCMonth() + 1).padStart(2, "0")}-${String(previousDay.getUTCDate()).padStart(2, "0")}`;
  return Date.now() >= seoulTimestamp(cutoffDate, 11);
}

export function storeResponseDeadlinePassed(pickupDate: string) {
  return Date.now() >= seoulTimestamp(pickupDate, 10);
}
