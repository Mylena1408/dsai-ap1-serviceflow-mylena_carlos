"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createRequest } from "@/modules/requests";
import { ApplicationError, ValidationError } from "@/server/errors";
import { DocumentStorageError } from "@/server/storage";

// File inputs are named "attachment:<requirementId>" (SPEC 21.4 item 2).
const ATTACHMENT_FIELD_PREFIX = "attachment:";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

// Only the requirement link, the name and the bytes leave the form; every stored field is
// derived on the server. An input left empty arrives as a nameless empty file and is skipped.
async function attachments(formData: FormData) {
  const uploads = [];

  for (const [name, value] of formData.entries()) {
    if (!name.startsWith(ATTACHMENT_FIELD_PREFIX) || typeof value === "string") continue;
    if (value.name === "" && value.size === 0) continue;

    uploads.push({
      requirementId: name.slice(ATTACHMENT_FIELD_PREFIX.length),
      name: value.name,
      bytes: new Uint8Array(await value.arrayBuffer()),
    });
  }

  return uploads;
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
    });
    requestId = request.id;
  } catch (error) {
    if (error instanceof ApplicationError) {
      redirect(`/catalog/${encodeURIComponent(serviceId)}?error=${errorCode(error)}`);
    }

    throw error;
  }

  revalidatePath("/catalog");
  revalidatePath("/requests");
  redirect(`/requests/${requestId}?notice=created`);
}
