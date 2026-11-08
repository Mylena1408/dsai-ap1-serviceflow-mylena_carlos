import { describe, expect, it, vi } from "vitest";
import { ConflictError } from "@/server/errors";
import { runRecurringSchedules, type RecurringRunStore, type ScheduleForRun } from "@/modules/requests/application/recurring-runs";

// SPEC 2026-11-07-operacao-e-automacao, 5.3 item 3 (SF-186): which schedules run, and how one run's
// conflict or failure leaves the others alone.

const today = "2026-11-09"; // a Monday

const schedule = (id: string, overrides: Partial<ScheduleForRun> = {}): ScheduleForRun => ({
  id,
  serviceId: "s",
  requesterId: "r",
  description: "x",
  answers: {},
  frequency: "WEEKLY",
  weekdays: [1],
  monthDay: null,
  startsOn: "2026-11-02",
  endsOn: null,
  pausedAt: null,
  endedAt: null,
  consecutiveFailures: 0,
  lastRunOn: null,
  ...overrides,
});

function store(schedules: ScheduleForRun[], run: RecurringRunStore["run"]): RecurringRunStore {
  return { today: vi.fn(async () => today), activeSchedules: vi.fn(async () => schedules), run };
}

describe("the job's runs (5.3 item 3)", () => {
  it("tries only the schedules with a day due, and never past their end", async () => {
    const run = vi.fn(async () => "none" as never);
    await runRecurringSchedules(
      store(
        [
          schedule("due"),
          schedule("ran", { lastRunOn: today }),
          // Starting today, its first Tuesday is tomorrow.
          schedule("other-day", { weekdays: [2], startsOn: today }),
          schedule("past-end", { startsOn: "2026-10-05", endsOn: "2026-11-08" }),
        ],
        run,
      ),
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("ignores a conflict (another run did the day) and counts an unexpected failure without stopping", async () => {
    let call = 0;
    const run = vi.fn(async () => {
      call += 1;
      if (call === 1) throw new ConflictError();
      if (call === 2) throw new Error("boom");
      return "opened" as never;
    });
    await expect(runRecurringSchedules(store([schedule("a"), schedule("b"), schedule("c")], run))).resolves.toEqual({
      opened: 1,
      skipped: 0,
      paused: 0,
      failed: 1,
    });
  });
});
