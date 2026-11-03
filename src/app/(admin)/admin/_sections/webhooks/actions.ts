"use server";

import { revalidatePath } from "next/cache";
import { createWebhook, resendWebhookDelivery, rotateWebhookSecret, setWebhookActive, updateWebhook } from "@/modules/webhooks";
import { scheduleEventProcessing } from "@/server/jobs/schedule";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { activeState, field, finish, reportFailure } from "../../_shared/action-helpers";

// "Webhooks" of the administration (SPEC 2026-11-02-api-externa-webhooks, 5.6). A new secret goes
// back only in the action's answer, shown once: never in the URL, the database in clear or a log.

export interface WebhookSecretState {
  status: "idle" | "created" | "error";
  message: string;
  secret?: string;
  name?: string;
}

function form(formData: FormData) {
  return {
    name: field(formData, "name"),
    url: field(formData, "url"),
    eventTypes: formData.getAll("eventTypes").filter((value): value is string => typeof value === "string"),
    // SPEC 2026-11-03-api-acoes-webhooks-setor, 5.2: none checked means every sector.
    sectorIds: formData.getAll("sectorIds").filter((value): value is string => typeof value === "string"),
  };
}

function refusal(error: unknown): WebhookSecretState {
  if (error instanceof ValidationError) {
    const path = error.issues[0]?.path[0];
    if (path === "url") {
      return { status: "error", message: "Endereço não aceito: use https com um nome público, sem usuário e senha, na porta padrão, 443 ou 8443." };
    }
    if (path === "eventTypes") return { status: "error", message: "Escolha pelo menos um evento." };
    if (path === "sectorIds") return { status: "error", message: "Um dos setores escolhidos não existe mais. Atualize a página." };
    return { status: "error", message: "Informe um nome de até 60 caracteres." };
  }
  if (error instanceof ConflictError) {
    return { status: "error", message: "Não foi possível: os webhooks não estão configurados ou já há 10 webhooks ativos." };
  }
  if (error instanceof NotFoundError) return { status: "error", message: "O webhook não existe mais." };
  throw error;
}

export async function createWebhookAction(_previous: WebhookSecretState, formData: FormData): Promise<WebhookSecretState> {
  try {
    const { webhook, secret } = await createWebhook(form(formData));
    revalidatePath("/admin");
    return { status: "created", message: "Webhook criado.", secret, name: webhook.name };
  } catch (error) {
    return refusal(error);
  }
}

export async function rotateWebhookSecretAction(_previous: WebhookSecretState, formData: FormData): Promise<WebhookSecretState> {
  try {
    const { webhook, secret } = await rotateWebhookSecret({ webhookId: field(formData, "webhookId") });
    revalidatePath("/admin");
    return { status: "created", message: "Novo segredo gerado.", secret, name: webhook.name };
  } catch (error) {
    return refusal(error);
  }
}

export async function updateWebhookAction(formData: FormData): Promise<never> {
  try {
    await updateWebhook({ webhookId: field(formData, "webhookId"), ...form(formData) });
  } catch (error) {
    reportFailure("webhooks", "webhooks", error);
  }
  return finish("webhooks", "updated", "webhooks");
}

export async function setWebhookActiveAction(formData: FormData): Promise<never> {
  try {
    await setWebhookActive({ webhookId: field(formData, "webhookId"), isActive: activeState(formData) });
  } catch (error) {
    reportFailure("webhooks", "webhooks", error);
  }
  return finish("webhooks", "status", "webhooks");
}

/** "Reenviar" (SPEC 2026-11-03-api-acoes-webhooks-setor, 5.3): sent right after the answer. */
export async function resendWebhookDeliveryAction(formData: FormData): Promise<never> {
  try {
    await resendWebhookDelivery({ deliveryId: field(formData, "deliveryId") });
  } catch (error) {
    reportFailure("webhookDeliveries", "webhooks", error);
  }
  scheduleEventProcessing();
  return finish("webhookDeliveries", "resent", "webhooks");
}
