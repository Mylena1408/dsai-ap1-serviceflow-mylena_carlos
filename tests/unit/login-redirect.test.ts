import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  },
}));

import LoginPage from "@/app/login/page";

// SPEC 2026-09-30, section 24 (CA-ENT-02): there is no login screen; old links go home.
describe("old login address", () => {
  it("redirects to the entrance", () => {
    expect(() => LoginPage()).toThrow(/^REDIRECT:\/$/);
  });
});
