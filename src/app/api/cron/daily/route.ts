import { runDailyJob } from "@/server/jobs";
import { isAuthorizedCronRequest } from "@/server/jobs/cron-auth";

// Daily job called by Vercel Cron (vercel.json). Without the right CRON_SECRET it does
// nothing (SPEC 2026-10-31-eventos-outbox-jobs, section 7).
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const summary = await runDailyJob();
  const failed = Object.values(summary).some((step) => step.status === "error");

  if (failed) {
    console.error("Daily job finished with errors.", summary);
  }

  return Response.json(summary, { status: failed ? 500 : 200, headers: { "Cache-Control": "no-store" } });
}
