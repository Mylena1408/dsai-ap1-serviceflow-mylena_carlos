// SPEC 2026-11-03-api-acoes-webhooks-setor, 5.1: the handler lives in the public-api module.
import { postStart } from "@/modules/public-api";

export const POST = postStart;
