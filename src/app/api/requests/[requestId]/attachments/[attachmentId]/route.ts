import { buildAttachmentContentDisposition, getAttachmentDownload } from "@/modules/requests";
import {
  ApplicationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ValidationError,
  toErrorResponse,
} from "@/server/errors";

type AttachmentRouteContext = {
  params: Promise<{ requestId: string; attachmentId: string }>;
};

const NO_STORE = "private, no-store";

function errorResponse(error: ApplicationError): Response {
  // Unauthenticated, denied, malformed and missing all answer as "not found", so the
  // route never reveals whether the attachment exists (SPEC 21.5 item 3, CA-DOC-16).
  const denied =
    error instanceof AuthenticationError ||
    error instanceof AuthorizationError ||
    error instanceof ValidationError ||
    error instanceof NotFoundError;
  const { status, body } = toErrorResponse(denied ? new NotFoundError() : error);

  return Response.json(body, {
    status,
    headers: { "Cache-Control": NO_STORE, "X-Content-Type-Options": "nosniff" },
  });
}

// Authorized download intermediated by the server (SPEC 21.5, 21.15.6). The URL carries
// only identifiers; the storage key and the provider URL never reach the client.
export async function GET(_request: Request, { params }: AttachmentRouteContext) {
  const { requestId, attachmentId } = await params;

  try {
    const download = await getAttachmentDownload(requestId, attachmentId);

    return new Response(new Blob([new Uint8Array(download.bytes)]), {
      status: 200,
      headers: {
        "Content-Type": download.contentType,
        "Content-Length": String(download.bytes.length),
        "Content-Disposition": buildAttachmentContentDisposition(download.filename),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": NO_STORE,
      },
    });
  } catch (error) {
    if (error instanceof ApplicationError) {
      return errorResponse(error);
    }

    throw error;
  }
}
