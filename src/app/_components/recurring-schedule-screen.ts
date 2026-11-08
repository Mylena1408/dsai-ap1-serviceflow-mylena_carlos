import { listScheduleOverview, listScheduleServiceFields, type ScheduleOverview, type ScheduleView } from "@/modules/recurring-requests";
import { NotFoundError } from "@/server/errors";
import { parseFieldErrors } from "@/app/(requester)/catalog/[serviceId]/field-errors";
import type { FieldErrorCode, OpeningField } from "@/app/(requester)/catalog/[serviceId]/request-form";

// What the schedules screen needs (SPEC 2026-11-07-operacao-e-automacao, 5.3 item 4), shared by the
// administration and the manager's area: the overview and, when a form is open, its service's fields.

export interface ScheduleScreenQuery {
  schedule?: string;
  service?: string;
  edit?: string;
  fields?: string;
}

export interface ScheduleScreen {
  overview: ScheduleOverview;
  message?: string;
  /** The form open on the page: a new schedule for a service, or a schedule being changed. */
  form: {
    serviceId: string;
    serviceName: string;
    editing: ScheduleView | null;
    fields: OpeningField[];
    fieldErrors: Record<string, FieldErrorCode>;
  } | null;
  /** The schedule asked for could not be changed now (its service can no longer be scheduled). */
  formUnavailable: boolean;
}

export async function loadScheduleScreen(query: ScheduleScreenQuery): Promise<ScheduleScreen> {
  const overview = await listScheduleOverview();
  const editing = query.edit ? (overview.schedules.find(({ id, actions }) => id === query.edit && actions.includes("edit")) ?? null) : null;
  const chosen = editing ? null : (overview.services.find(({ id }) => id === query.service) ?? null);
  const serviceId = editing?.service.id ?? chosen?.id ?? null;
  const base = { overview, message: query.schedule };

  if (!serviceId) {
    return { ...base, form: null, formUnavailable: Boolean(query.edit) };
  }

  let fields: OpeningField[];
  try {
    fields = (await listScheduleServiceFields(serviceId)).map((item) => ({
      id: item.id,
      label: item.label,
      helpText: item.helpText,
      type: item.type,
      isRequired: item.isRequired,
      options: item.options,
      minValue: item.minValue,
      maxValue: item.maxValue,
      decimalPlaces: item.decimalPlaces,
      minDecimal: item.minDecimal,
      maxDecimal: item.maxDecimal,
      conditionFieldId: item.conditionFieldId ?? null,
      conditionValue: item.conditionValue ?? null,
    }));
  } catch (error) {
    if (error instanceof NotFoundError) return { ...base, form: null, formUnavailable: true };
    throw error;
  }

  const fieldErrors = query.schedule === "schedule-fields" ? parseFieldErrors(query.fields, new Set(fields.map(({ id }) => id))) : {};
  return {
    ...base,
    form: { serviceId, serviceName: editing?.service.name ?? chosen?.name ?? "", editing, fields, fieldErrors },
    formUnavailable: false,
  };
}
