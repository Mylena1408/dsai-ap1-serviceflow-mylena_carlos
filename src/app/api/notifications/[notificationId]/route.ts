import { openNotification } from "@/modules/notifications";
import { requireCurrentActor } from "@/server/authorization";
import { ApplicationError } from "@/server/errors";

type NotificationRouteContext = {
  params: Promise<{ notificationId: string }>;
};

// Relative Location: the browser stays on the host it is using. Building an absolute URL
// from request.url sent users to another host (localhost vs 127.0.0.1) without their
// session cookie, which the E2E caught.
function redirectTo(_request: Request, path: string): Response {
  return new Response(null, { status: 303, headers: { Location: path, "Cache-Control": "no-store" } });
}

// Opening a notification marks it as read and leads to the request page, which applies
// the usual access rules (SPEC 2026-10-31-eventos-outbox-jobs, section 8.2).
export async function GET(request: Request, { params }: NotificationRouteContext) {
  const { notificationId } = await params;

  try {
    const actor = await requireCurrentActor();
    const listPath = actor.role === "ATTENDANT" ? "/queue/notifications" : "/notifications";
    const requestId = await openNotification(notificationId);

    if (!requestId) {
      return redirectTo(request, listPath);
    }

    return redirectTo(request, actor.role === "ATTENDANT" ? `/queue/${requestId}` : `/requests/${requestId}`);
  } catch (error) {
    if (error instanceof ApplicationError) {
      return redirectTo(request, error.code === "UNAUTHENTICATED" ? "/login" : "/");
    }

    throw error;
  }
}
