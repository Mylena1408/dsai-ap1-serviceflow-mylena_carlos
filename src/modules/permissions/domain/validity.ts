import { z } from "zod";
import { ValidationError } from "@/server/errors";
import { addDays, calendarDayError } from "@/shared/time";

// End of a grant or of a role assignment (SPEC 2026-11-06-aprofundamento-configurabilidade, 6.3.2,
// decision G14). The end is the organization's calendar day ("YYYY-MM-DD") up to which it counts,
// both included; absent means no end.

export const MAX_VALIDITY_DAYS = 365;

/** Blank or absent is "no end"; otherwise a calendar day. */
export const validityEndSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => (value === undefined || value === null || value.trim() === "" ? null : value.trim()))
  .refine((value) => value === null || calendarDayError(value) === null);

/** 6.3.2: from today up to 365 days ahead; a day in the past would grant nothing. */
export function assertValidityEnd(expiresOn: string | null, today: string, path = "expiresOn"): void {
  if (expiresOn === null) {
    return;
  }
  if (expiresOn < today) {
    throw new ValidationError([{ path: [path], code: "too_small" }]);
  }
  if (expiresOn > addDays(today, MAX_VALIDITY_DAYS)) {
    throw new ValidationError([{ path: [path], code: "too_big" }]);
  }
}

/** Whether a grant or assignment with this end still counts today. */
export function isWithinValidity(expiresOn: string | null, today: string): boolean {
  return expiresOn === null || expiresOn >= today;
}

export type ValidityState = { kind: "none" } | { kind: "active"; until: string } | { kind: "ended"; on: string };

export function validityState(expiresOn: string | null, today: string): ValidityState {
  if (expiresOn === null) {
    return { kind: "none" };
  }

  return isWithinValidity(expiresOn, today) ? { kind: "active", until: expiresOn } : { kind: "ended", on: expiresOn };
}

function brazilianDay(day: string): string {
  const [year, month, date] = day.split("-");
  return `${date}/${month}/${year}`;
}

/** 6.3.2: what the screens show, "vence em …" or "vencida em …"; nothing without an end. */
export function validityLabel(expiresOn: string | null, today: string): string | null {
  const state = validityState(expiresOn, today);

  switch (state.kind) {
    case "none":
      return null;
    case "active":
      return `vence em ${brazilianDay(state.until)}`;
    case "ended":
      return `vencida em ${brazilianDay(state.on)}`;
  }
}
