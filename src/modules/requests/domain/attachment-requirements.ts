import type { DetectedDocumentFormat } from "@/modules/attachments";
import { ValidationError } from "@/server/errors";

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
