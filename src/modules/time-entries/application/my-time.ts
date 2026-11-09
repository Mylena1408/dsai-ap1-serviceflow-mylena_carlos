import { requireCurrentActor } from "@/server/authorization";
import { AuthorizationError } from "@/server/errors";
import type { ReportPeriod } from "@/modules/reports";

// "Minhas horas" (SPEC 2026-11-08-atendimento-dia-a-dia, 13.2 item 2; decision J5): in "Meu painel", the hours the
// attendant logged in the period, by day and by service. Only the person's own entries, whatever the request's
// sector is now; removed entries do not count.

export interface MyTimeRow {
  workedOn: string;
  serviceName: string;
  minutes: number;
  entries: number;
}

export interface MyTimeReader {
  sums(userId: string, period: { firstDay: string; lastDay: string }): Promise<MyTimeRow[]>;
}

export interface MyTime {
  totalMinutes: number;
  /** The days with time, most recent first. */
  byDay: Array<{ day: string; minutes: number }>;
  /** Most hours first, then by name. */
  byService: Array<{ label: string; minutes: number; entries: number }>;
}

const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });

export function summarizeMyTime(rows: readonly MyTimeRow[]): MyTime {
  const days = new Map<string, number>();
  const services = new Map<string, { minutes: number; entries: number }>();
  for (const row of rows) {
    days.set(row.workedOn, (days.get(row.workedOn) ?? 0) + row.minutes);
    const service = services.get(row.serviceName) ?? { minutes: 0, entries: 0 };
    service.minutes += row.minutes;
    service.entries += row.entries;
    services.set(row.serviceName, service);
  }
  return {
    totalMinutes: rows.reduce((sum, row) => sum + row.minutes, 0),
    byDay: [...days.entries()].map(([day, minutes]) => ({ day, minutes })).sort((left, right) => right.day.localeCompare(left.day)),
    byService: [...services.entries()]
      .map(([label, value]) => ({ label, ...value }))
      .sort((left, right) => right.minutes - left.minutes || collator.compare(left.label, right.label)),
  };
}

/** Only an attendant has "Meu painel" (the session already requires an active person). */
export async function getMyTime(period: ReportPeriod, reader: MyTimeReader): Promise<MyTime> {
  const actor = await requireCurrentActor();
  if (actor.role !== "ATTENDANT") throw new AuthorizationError();
  return summarizeMyTime(await reader.sums(actor.id, period));
}
