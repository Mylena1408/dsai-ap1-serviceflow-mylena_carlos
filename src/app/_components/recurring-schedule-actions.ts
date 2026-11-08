"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { changeScheduleState, createSchedule, updateSchedule } from "@/modules/recurring-requests";
import { FieldAnswersError } from "@/modules/service-fields";
import { ApplicationError, ValidationError } from "@/server/errors";

// Schedules of recurring requests from the administration and the manager's area (SPEC
// 2026-11-07-operacao-e-automacao, 5.3 items 1, 2 and 4). The page to go back to is one of the known ones,
// never an address from the form; refused answers go back as field ids and fixed codes, never as values.

const PAGES = { approvals: "/approvals/recurring", admin: "/admin?section=recurring" } as const;
const CUSTOM_FIELD_PREFIX = "field.";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function pageOf(formData: FormData): string {
  return field(formData, "area") === "admin" ? PAGES.admin : PAGES.approvals;
}

function withQuery(page: string, query: string): string {
  return `${page}${page.includes("?") ? "&" : "?"}${query}`;
}

function scheduleInput(formData: FormData) {
  const answers: Record<string, string | string[]> = {};
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith(CUSTOM_FIELD_PREFIX) || typeof value !== "string") continue;
    const id = name.slice(CUSTOM_FIELD_PREFIX.length);
    const previous = answers[id];
    // Several boxes of a multiple choice share the name.
    answers[id] = previous === undefined ? value : [...(Array.isArray(previous) ? previous : [previous]), value];
  }
  return {
    name: field(formData, "name"),
    serviceId: field(formData, "serviceId"),
    requesterId: field(formData, "requesterId"),
    description: field(formData, "description"),
    answers,
    frequency: field(formData, "frequency"),
    weekdays: formData.getAll("weekdays").filter((value): value is string => typeof value === "string"),
    monthDay: field(formData, "monthDay"),
    startsOn: field(formData, "startsOn"),
    endsOn: field(formData, "endsOn"),
  };
}

/** The message code of a refusal (internal: only async exports become actions). */
function errorQuery(error: ApplicationError): string {
  if (error instanceof FieldAnswersError) {
    if (error.reason === "stale_form") return "schedule=schedule-fields-changed";
    const list = error.fieldErrors.map(({ fieldId, code }) => `${fieldId}.${code}`).join(",");
    return `schedule=schedule-fields&fields=${encodeURIComponent(list)}`;
  }
  if (error instanceof ValidationError) {
    const paths = error.issues.flatMap(({ path }) => path);
    if (error.issues.some(({ path, code }) => path.length === 0 && code === "too_big")) return "schedule=schedule-limit";
    if (paths.includes("startsOn") || paths.includes("endsOn")) return "schedule=schedule-dates";
    if (paths.includes("weekdays") || paths.includes("monthDay") || paths.includes("frequency")) return "schedule=schedule-frequency";
    if (paths.includes("requesterId")) return "schedule=schedule-requester";
    if (paths.includes("serviceId")) return "schedule=schedule-service";
    return "schedule=schedule-invalid";
  }
  if (error.code === "CONFLICT") return "schedule=schedule-state";
  if (error.code === "NOT_FOUND" || error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN") return "schedule=schedule-missing";
  return "schedule=schedule-unexpected";
}

async function run(formData: FormData, work: () => Promise<unknown>, notice: string, formQuery: string | null): Promise<never> {
  const page = pageOf(formData);
  try {
    await work();
  } catch (error) {
    if (error instanceof ApplicationError) {
      // A refused form opens again, with what was typed kept by the form itself.
      redirect(withQuery(page, formQuery ? `${formQuery}&${errorQuery(error)}` : errorQuery(error)));
    }
    throw error;
  }
  revalidatePath(page.split("?")[0]);
  redirect(withQuery(page, `schedule=${notice}`));
}

export async function createScheduleAction(formData: FormData): Promise<never> {
  const input = scheduleInput(formData);
  return run(formData, () => createSchedule(input), "schedule-created", `service=${encodeURIComponent(input.serviceId)}`);
}

export async function updateScheduleAction(formData: FormData): Promise<never> {
  const scheduleId = field(formData, "scheduleId");
  return run(formData, () => updateSchedule(scheduleId, scheduleInput(formData)), "schedule-updated", `edit=${encodeURIComponent(scheduleId)}`);
}

export async function pauseScheduleAction(formData: FormData): Promise<never> {
  return run(formData, () => changeScheduleState(field(formData, "scheduleId"), "pause"), "schedule-paused", null);
}

export async function resumeScheduleAction(formData: FormData): Promise<never> {
  return run(formData, () => changeScheduleState(field(formData, "scheduleId"), "resume"), "schedule-resumed", null);
}

export async function endScheduleAction(formData: FormData): Promise<never> {
  return run(formData, () => changeScheduleState(field(formData, "scheduleId"), "end"), "schedule-ended", null);
}
