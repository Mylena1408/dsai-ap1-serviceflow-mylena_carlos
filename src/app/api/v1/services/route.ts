// SPEC 2026-11-02-api-externa-webhooks, 5.4: the handler lives in the public-api module.
import { getServices } from "@/modules/public-api";

export const GET = getServices;
