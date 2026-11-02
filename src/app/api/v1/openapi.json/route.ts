// SPEC 2026-11-02-api-externa-webhooks, 5.4: the handler lives in the public-api module.
import { getOpenApiDocument } from "@/modules/public-api";

export const GET = getOpenApiDocument;
