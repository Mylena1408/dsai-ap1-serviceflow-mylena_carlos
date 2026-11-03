import { MAX_ATTACHMENTS_PER_REQUEST, MAX_ATTACHMENTS_TOTAL_BYTES, type DetectedDocumentFormat } from "@/modules/attachments";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";

export interface ActiveDocumentRequirement {
  id: string;
  name: string;
  isRequired: boolean;
  acceptedFormats: DetectedDocumentFormat[];
}

export interface RequirementMatch<T> {
  attachment: T;
  requirement: ActiveDocumentRequirement;
}

// Fixed messages that never echo file names or content (SPEC 21.4 item 4, 21.10).
function requirementError(code: "invalid_value" | "too_small") {
  return new ValidationError([{ path: ["attachments"], code }]);
}

/**
 * Pairs each file with an active requirement of the requested service (SPEC 21.4 item 3):
 * no files for a service without active requirements, no unknown, inactive or foreign
 * requirement, at most one file per requirement and every required requirement covered.
 * `requirements` must be the service's active requirements reloaded on the server.
 */
export function matchAttachmentsToRequirements<T extends { requirementId: string }>(
  requirements: readonly ActiveDocumentRequirement[],
  attachments: readonly T[],
): RequirementMatch<T>[] {
  const byId = new Map(requirements.map((requirement) => [requirement.id, requirement]));
  const covered = new Set<string>();

  const matches = attachments.map((attachment) => {
    const requirement = byId.get(attachment.requirementId);

    if (!requirement || covered.has(requirement.id)) {
      throw requirementError("invalid_value");
    }

    covered.add(requirement.id);
    return { attachment, requirement };
  });

  if (requirements.some((requirement) => requirement.isRequired && !covered.has(requirement.id))) {
    throw requirementError("too_small");
  }

  return matches;
}

/** Rejects a detected format the requirement no longer accepts (SPEC 21.4 item 5). */
export function assertFormatStillAccepted(
  requirement: ActiveDocumentRequirement,
  detectedFormat: DetectedDocumentFormat,
): void {
  if (!requirement.acceptedFormats.includes(detectedFormat)) {
    throw new ValidationError([{ path: ["attachments"], code: "invalid_format" }]);
  }
}

/** State read for a document sent after the opening (SPEC 2026-11-03-anexos-comentarios-documentos). */
export interface LateDocumentContext {
  actor: { id: string; role: string; isActive: boolean };
  request: { requesterId: string; status: "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" };
  /** The active requirement of the request's service with that id, or null. */
  requirement: ActiveDocumentRequirement | null;
  /** Documents already in the request: requirement and size. */
  documents: ReadonlyArray<{ requirementId: string; sizeBytes: number }>;
  size: number;
}

/**
 * Section 5.3 (decisions X4 and X5): only the requester who owns the request, while it is open or
 * in progress, sends a document for an active requirement of the service that has none yet,
 * within the per-request limits of section 21 (5 documents, 4 MiB together).
 */
export function assertCanAddLateDocument({ actor, request, requirement, documents, size }: LateDocumentContext): ActiveDocumentRequirement {
  if (!actor.isActive || actor.role !== "REQUESTER" || actor.id !== request.requesterId) {
    throw new NotFoundError();
  }

  if (request.status !== "OPEN" && request.status !== "IN_PROGRESS") {
    throw new ConflictError();
  }

  if (!requirement || documents.some(({ requirementId }) => requirementId === requirement.id)) {
    throw requirementError("invalid_value");
  }

  const total = documents.reduce((sum, document) => sum + document.sizeBytes, 0) + size;

  if (documents.length + 1 > MAX_ATTACHMENTS_PER_REQUEST || total > MAX_ATTACHMENTS_TOTAL_BYTES) {
    throw new ValidationError([{ path: ["attachments"], code: "too_big" }]);
  }

  return requirement;
}
