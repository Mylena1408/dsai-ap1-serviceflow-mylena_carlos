import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jobs = vi.hoisted(() => ({ runDailyJob: vi.fn() }));
vi.mock("@/server/jobs", () => jobs);

import { GET } from "@/app/api/cron/daily/route";

// SPEC 2026-10-31-eventos-outbox-jobs, section 7 (SF-062).

const SECRET = "a-cron-secret-with-24-chars";
const call = (authorization?: string) =>
  GET(new Request("http://localhost/api/cron/daily", { headers: authorization ? { authorization } : {} }));

describe("daily cron route (CA-EVT-05)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses calls without the secret and runs nothing", async () => {
    for (const header of [undefined, "Bearer wrong"]) {
      const response = await call(header);
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);
    expect(jobs.runDailyJob).not.toHaveBeenCalled();
  });

  it("runs the daily job and reports each step", async () => {
    const summary = {
      events: { status: "ok", result: { processed: 2, retried: 0, failed: 0 } },
      purgedEvents: { status: "ok", result: 5 },
      orphanObjects: { status: "skipped" },
    };
    jobs.runDailyJob.mockResolvedValueOnce(summary);

    const response = await call(`Bearer ${SECRET}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(summary);
  });

  it("answers 500 when a step failed, with codes only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    jobs.runDailyJob.mockResolvedValueOnce({
      events: { status: "error", code: "P1001" },
      purgedEvents: { status: "ok", result: 0 },
      orphanObjects: { status: "skipped" },
    });

    try {
      const response = await call(`Bearer ${SECRET}`);
      expect(response.status).toBe(500);
      expect(log).toHaveBeenCalledOnce();
    } finally {
      log.mockRestore();
    }
  });
});
