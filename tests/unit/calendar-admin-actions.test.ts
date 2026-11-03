import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({ createService: vi.fn(), updateService: vi.fn(), setServiceActive: vi.fn() }));
const calendar = vi.hoisted(() => ({ updateCalendar: vi.fn(), createHoliday: vi.fn(), deleteHoliday: vi.fn() }));
const nextNavigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("@/modules/services", () => services);
vi.mock("@/modules/calendar", () => calendar);
vi.mock("@/modules/document-requirements", () => ({}));
vi.mock("@/modules/service-fields", () => ({}));
vi.mock("@/modules/service-stages", () => ({}));
vi.mock("next/navigation", () => nextNavigation);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createServiceAction } from "@/app/(admin)/admin/_sections/services/actions";
import { createHolidayAction, deleteHolidayAction, updateCalendarAction } from "@/app/(admin)/admin/_sections/calendar/actions";
import { announcement } from "@/app/(admin)/admin/_shared/announcement";
import { ConflictError, ValidationError } from "@/server/errors";

// SPEC 2026-11-03-pausa-sla-calendario, 5.2 and 5.7 (SF-129).

function formData(values: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
}

const base = { name: "Reparo", description: "Conserto", categoryId: "category", sectorId: "sector" };
const initial = { status: "error" as const, message: "" };

async function redirectOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return (error as Error).message.replace("REDIRECT:", "");
  }
  throw new Error("no redirect");
}

describe("SLA clock of the service form (5.2)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends the clock as a boolean, and an unexpected value for the server to refuse", async () => {
    await createServiceAction(initial, formData({ ...base, slaHours: "8", slaClock: "business" }));
    await createServiceAction(initial, formData({ ...base, slaHours: "8", slaClock: "calendar" }));
    await createServiceAction(initial, formData({ ...base, slaHours: "8", slaClock: "lunar" }));

    expect(services.createService.mock.calls.map(([input]) => input.slaBusinessHours)).toEqual([true, false, "lunar"]);
  });
});

describe("calendar section actions (5.7)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends every checked weekday and the window, and reports the outcome", async () => {
    const saved = await redirectOf(() =>
      updateCalendarAction(formData({ weekdays: ["1", "3"], startTime: "08:00", endTime: "17:00", timeZone: "America/Belem" })),
    );

    expect(calendar.updateCalendar).toHaveBeenCalledWith({ weekdays: ["1", "3"], startTime: "08:00", endTime: "17:00", timeZone: "America/Belem" });
    expect(saved).toBe("/admin?section=calendar&notice=updated&entity=calendar");
    expect(announcement(undefined, "updated", "calendar")).toBe("Expediente salvo. Vale para os próximos cálculos de prazo.");

    calendar.updateCalendar.mockRejectedValueOnce(new ValidationError([{ path: ["endTime"], code: "invalid_value" }]));
    const refused = await redirectOf(() => updateCalendarAction(formData({ weekdays: [], startTime: "18:00", endTime: "08:00", timeZone: "UTC" })));
    expect(refused).toBe("/admin?section=calendar&error=validation&entity=calendar");
    expect(announcement("validation", undefined, "calendar")).toContain("marque pelo menos um dia");
  });

  it("creates and removes holidays", async () => {
    expect(await redirectOf(() => createHolidayAction(formData({ day: "2026-12-25", name: "Natal", yearly: "on" }))))
      .toBe("/admin?section=calendar&notice=created&entity=holidays");
    expect(calendar.createHoliday).toHaveBeenCalledWith({ day: "2026-12-25", name: "Natal", yearly: true });

    calendar.createHoliday.mockRejectedValueOnce(new ConflictError());
    expect(await redirectOf(() => createHolidayAction(formData({ day: "2026-12-25", name: "Outro" })))).toBe(
      "/admin?section=calendar&error=dependency&entity=holidays",
    );
    expect(announcement("dependency", undefined, "holidays")).toBe("Já existe um feriado cadastrado nessa data.");

    expect(await redirectOf(() => deleteHolidayAction(formData({ holidayId: "h1" })))).toBe("/admin?section=calendar&notice=deleted&entity=holidays");
    expect(calendar.deleteHoliday).toHaveBeenCalledWith({ holidayId: "h1" });
    expect(announcement(undefined, "deleted", "holidays")).toBe("Feriado removido.");
  });
});
