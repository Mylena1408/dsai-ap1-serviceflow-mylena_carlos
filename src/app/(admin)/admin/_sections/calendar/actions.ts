"use server";

import { createHoliday, deleteHoliday, updateCalendar } from "@/modules/calendar";
import { field, finish, reportFailure } from "../../_shared/action-helpers";

// "Calendário" of the administration (SPEC 2026-11-03-pausa-sla-calendario, 5.1 and 5.7).

export async function updateCalendarAction(formData: FormData): Promise<never> {
  try {
    await updateCalendar({
      weekdays: formData.getAll("weekdays").filter((value): value is string => typeof value === "string"),
      startTime: field(formData, "startTime"),
      endTime: field(formData, "endTime"),
      timeZone: field(formData, "timeZone"),
    });
  } catch (error) {
    reportFailure("calendar", "calendar", error);
  }
  return finish("calendar", "updated", "calendar");
}

export async function createHolidayAction(formData: FormData): Promise<never> {
  try {
    await createHoliday({
      day: field(formData, "day"),
      name: field(formData, "name"),
      yearly: formData.get("yearly") === "on",
    });
  } catch (error) {
    reportFailure("holidays", "calendar", error);
  }
  return finish("holidays", "created", "calendar");
}

export async function deleteHolidayAction(formData: FormData): Promise<never> {
  try {
    await deleteHoliday({ holidayId: field(formData, "holidayId") });
  } catch (error) {
    reportFailure("holidays", "calendar", error);
  }
  return finish("holidays", "deleted", "calendar");
}
