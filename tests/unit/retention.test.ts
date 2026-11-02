import { describe, expect, it } from "vitest";
import { RETENTION_PERIODS, retentionCutoff } from "@/shared/retention";

// SPEC 2026-11-02-auditoria-lgpd, 5.3 (SF-105; CA-AUD-05).

const now = new Date("2026-11-02T15:00:00.000Z");

describe("retention periods (CA-AUD-05)", () => {
  it("keeps the deadlines of table 5.3, including the ones that already existed", () => {
    expect(RETENTION_PERIODS).toEqual({
      processedEvents: { days: 30 },
      readNotifications: { days: 90 },
      unreadNotifications: { days: 365 },
      emailDeliveries: { days: 180 },
      auditEntries: { years: 5 },
    });
  });

  it("counts days back from now, to the millisecond", () => {
    expect(retentionCutoff("processedEvents", now)).toEqual(new Date("2026-10-03T15:00:00.000Z"));
    expect(retentionCutoff("readNotifications", now)).toEqual(new Date("2026-08-04T15:00:00.000Z"));
    expect(retentionCutoff("unreadNotifications", now)).toEqual(new Date("2025-11-02T15:00:00.000Z"));
    expect(retentionCutoff("emailDeliveries", now)).toEqual(new Date("2026-05-06T15:00:00.000Z"));
  });

  it("counts calendar years for the audit trail", () => {
    expect(retentionCutoff("auditEntries", now)).toEqual(new Date("2021-11-02T15:00:00.000Z"));
    // February 29 does not exist five years back: the cutoff is March 1.
    expect(retentionCutoff("auditEntries", new Date("2028-02-29T10:00:00.000Z"))).toEqual(new Date("2023-03-01T10:00:00.000Z"));
  });

  it("does not change the date it receives", () => {
    const reference = new Date(now);
    retentionCutoff("auditEntries", reference);
    expect(reference).toEqual(now);
  });
});
