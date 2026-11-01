import { openNotification } from "@/modules/notifications";
import { requireCurrentActor } from "@/server/authorization";
import { ApplicationError } from "@/server/errors";

type NotificationRouteContext = {
  params: Promise<{ notificationId: string }>;
};

function redirectTo(request: Request, path: string): Response {
  return Response.redirect(new URL(path, request.url), 303);
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
