"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addComment } from "@/modules/comments";
import { scheduleEventProcessing } from "@/server/jobs/schedule";
import { addLateDocument, cancelRequest, createRequest, reopenRequest } from "@/modules/requests";
import { FieldAnswersError } from "@/modules/service-fields";
import { ApplicationError, ValidationError } from "@/server/errors";
import { DocumentStorageError } from "@/server/storage";
import { commentFileErrorCode, commentFiles, isEmptyFileInput } from "@/app/_components/comment-form-data";

// File inputs are named "attachment:<requirementId>" (SPEC 21.4 item 2).
const ATTACHMENT_FIELD_PREFIX = "attachment:";
// Custom field inputs are named "field.<fieldId>" (SPEC 2026-11-01-campos-personalizados, 9).
const CUSTOM_FIELD_PREFIX = "field.";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

// Only the requirement link, the name and the bytes leave the form; every stored field is
// derived on the server. An input left empty is skipped (isEmptyFileInput: Next.js delivers it as
// an empty file named "undefined"; fixed in SF-125, the check by an empty name never matched).
async function attachments(formData: FormData) {
  const uploads = [];

  for (const [name, value] of formData.entries()) {
    if (!name.startsWith(ATTACHMENT_FIELD_PREFIX) || typeof value === "string") continue;
    if (isEmptyFileInput(value)) continue;

    uploads.push({
      requirementId: name.slice(ATTACHMENT_FIELD_PREFIX.length),
      name: value.name,
      bytes: new Uint8Array(await value.arrayBuffer()),
    });
  }

  return uploads;
}

// Only sent when the form has custom fields, so services without them open as before.
function customFieldValues(formData: FormData): { fieldValues?: Record<string, string | string[]> } {
  const values: Record<string, string | string[]> = {};

  for (const [name, value] of formData.entries()) {
    if (name.startsWith(CUSTOM_FIELD_PREFIX) && typeof value === "string") {
      const id = name.slice(CUSTOM_FIELD_PREFIX.length);
      const previous = values[id];
      // The boxes of a multiple choice share the name (SPEC 2026-11-03-campos-condicionais-atendimento, 5.1).
      values[id] = previous === undefined ? value : [...(Array.isArray(previous) ? previous : [previous]), value];
    }
  }

  return Object.keys(values).length > 0 ? { fieldValues: values } : {};
}

// Refused answers go back as field ids and fixed codes, never as typed values (5.3.4).
function fieldErrorQuery(error: FieldAnswersError): string {
  if (error.reason === "stale_form") return "error=fields-changed";
  const list = error.fieldErrors.map(({ fieldId, code }) => `${fieldId}.${code}`).join(",");
  return `error=fields&fields=${encodeURIComponent(list)}`;
}

function errorCode(error: ApplicationError): string {
  if (error instanceof DocumentStorageError) return "documents-unavailable";
  if (error instanceof ValidationError) {
    return error.issues.some(({ path }) => path.includes("attachments"))
      ? "attachments"
      : "validation";
  }
  if (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN") return "access";
  if (error.code === "NOT_FOUND" || error.code === "CONFLICT") return "unavailable";
  return "unexpected";
}

export async function createRequestAction(formData: FormData): Promise<never> {
  const serviceId = field(formData, "serviceId");
  let requestId: string;

  try {
    const request = await createRequest({
      serviceId,
      description: field(formData, "description"),
      attachments: await attachments(formData),
      ...customFieldValues(formData),
    });
    requestId = request.id;
  } catch (error) {
    if (error instanceof ApplicationError) {
      const query = error instanceof FieldAnswersError ? fieldErrorQuery(error) : `error=${errorCode(error)}`;
      redirect(`/catalog/${encodeURIComponent(serviceId)}?${query}`);
    }

    throw error;
  }

  scheduleEventProcessing();
  revalidatePath("/catalog");
  revalidatePath("/requests");
  redirect(`/requests/${requestId}?notice=created`);
}

// Lifecycle actions on the requester's own request (SPEC 2026-10-31, sections 5.4 and 5.5).
function lifecycleErrorCode(error: ApplicationError): string {
  const fileCode = commentFileErrorCode(error);
  if (fileCode) return fileCode;
  if (error instanceof ValidationError) {
    if (error.issues.some(({ path }) => path.includes("body"))) return "body";
    return error.issues.some(({ path }) => path.includes("note")) ? "note" : "validation";
  }
  if (error.code === "NOT_FOUND" || error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN") {
    return "missing";
  }
  return error.code === "CONFLICT" ? "state" : "unexpected";
}

async function runOnOwnRequest(
  formData: FormData,
  operation: (requestId: string, note: string) => Promise<void>,
  notice: string,
): Promise<never> {
  const requestId = field(formData, "requestId");

  try {
    await operation(requestId, field(formData, "note"));
  } catch (error) {
    if (error instanceof ApplicationError) {
      redirect(`/requests/${encodeURIComponent(requestId)}?error=${lifecycleErrorCode(error)}`);
    }

    throw error;
  }

  scheduleEventProcessing();
  revalidatePath("/requests");
  revalidatePath(`/requests/${requestId}`);
  redirect(`/requests/${requestId}?notice=${notice}`);
}

export async function cancelOwnRequestAction(formData: FormData): Promise<never> {
  return runOnOwnRequest(formData, (requestId, note) => cancelRequest({ requestId, note }), "cancelled");
}

export async function reopenOwnRequestAction(formData: FormData): Promise<never> {
  return runOnOwnRequest(formData, (requestId, note) => reopenRequest({ requestId, note }), "reopened");
}

// SPEC 2026-11-03-anexos-comentarios-documentos, 5.3: a document the request still misses.
export async function addLateDocumentAction(formData: FormData): Promise<never> {
  const requestId = field(formData, "requestId");
  const value = formData.get("file");
  const file =
    value && typeof value !== "string" && !isEmptyFileInput(value)
      ? { name: value.name, bytes: new Uint8Array(await value.arrayBuffer()) }
      : { name: "", bytes: new Uint8Array() };

  try {
    await addLateDocument({ requestId, requirementId: field(formData, "requirementId"), file });
  } catch (error) {
    if (error instanceof ApplicationError) {
      const code =
        error instanceof DocumentStorageError
          ? "documents-unavailable"
          : error instanceof ValidationError
            ? "late-document"
            : lifecycleErrorCode(error);
      redirect(`/requests/${encodeURIComponent(requestId)}?error=${code}`);
    }

    throw error;
  }

  scheduleEventProcessing();
  revalidatePath(`/requests/${requestId}`);
  redirect(`/requests/${requestId}?notice=document`);
}

// Comments (SPEC 2026-10-31-comentarios): the requester never marks internal notes.
export async function addOwnCommentAction(formData: FormData): Promise<never> {
  const body = field(formData, "body");
  // SPEC 2026-11-03-anexos-comentarios-documentos, 5.1: files only when the form has them.
  const files = await commentFiles(formData);
  return runOnOwnRequest(formData, async (requestId) => {
    await addComment({ requestId, body, ...(files.length > 0 ? { files } : {}) });
  }, "commented");
}
