// SPEC 2026-11-03-transferencia-entre-setores, 5.8: the handler lives in the public-api module.
import { getSectorCandidates } from "@/modules/public-api";

export const GET = getSectorCandidates;
