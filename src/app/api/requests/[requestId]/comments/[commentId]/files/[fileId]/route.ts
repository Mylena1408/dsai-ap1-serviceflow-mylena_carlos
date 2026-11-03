import { getCommentFileDownload } from "@/modules/comments";
import { buildAttachmentContentDisposition } from "@/modules/requests";
import {
  ApplicationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ValidationError,
  toErrorResponse,
} from "@/server/errors";

type CommentFileRouteContext = {
  params: Promise<{ requestId: string; commentId: string; fileId: string }>;
};

const NO_STORE = "private, no-store";

function errorResponse(error: ApplicationError): Response {
  // Unauthenticated, denied, malformed and missing all answer as "not found", like the documents
  // (SPEC 2026-11-03-anexos-comentarios-documentos, 5.2).
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

// Download of a comment file intermediated by the server; the URL carries only identifiers.
export async function GET(_request: Request, { params }: CommentFileRouteContext) {
  const { requestId, commentId, fileId } = await params;

  try {
    const download = await getCommentFileDownload({ requestId, commentId, fileId });

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
