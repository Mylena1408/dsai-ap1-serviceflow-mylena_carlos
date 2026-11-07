"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cancelAttendantAbsence, registerAttendantAbsence } from "@/modules/absences";
import { ApplicationError, ValidationError } from "@/server/errors";

// Attendants' absences from the three areas (SPEC 2026-11-07-operacao-e-automacao, 4.3 item 7). The page
// to go back to is one of the known ones, never an address from the form.

const PAGES = { queue: "/queue/absences", approvals: "/approvals/team-absences", admin: "/admin?section=attendant-absences" } as const;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function pageOf(formData: FormData): string {
  const area = field(formData, "area");
  return area === "approvals" || area === "admin" ? PAGES[area] : PAGES.queue;
}

function errorCode(error: ApplicationError): string {
  if (error instanceof ValidationError && error.issues.some(({ path }) => path.includes("endsOn") || path.includes("startsOn"))) {
    return "attendant-absence-period";
  }
  if (error.code === "CONFLICT") return "attendant-absence-conflict";
  if (error.code === "NOT_FOUND" || error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN") return "attendant-absence-missing";
  return error.code === "VALIDATION_ERROR" ? "attendant-absence-invalid" : "attendant-absence-unexpected";
}

async function run(formData: FormData, work: () => Promise<unknown>, notice: string): Promise<never> {
  const page = pageOf(formData);
  const separator = page.includes("?") ? "&" : "?";
  try {
    await work();
  } catch (error) {
    if (error instanceof ApplicationError) redirect(`${page}${separator}absence=${errorCode(error)}`);
    throw error;
  }
  revalidatePath(page.split("?")[0]);
  redirect(`${page}${separator}absence=${notice}`);
}

export async function registerAttendantAbsenceAction(formData: FormData): Promise<never> {
  const userId = field(formData, "userId");
  return run(
    formData,
    () => registerAttendantAbsence({ ...(userId ? { userId } : {}), startsOn: field(formData, "startsOn"), endsOn: field(formData, "endsOn") }),
    "attendant-absence-registered",
  );
}

export async function cancelAttendantAbsenceAction(formData: FormData): Promise<never> {
  return run(formData, () => cancelAttendantAbsence(field(formData, "absenceId")), "attendant-absence-cancelled");
}
