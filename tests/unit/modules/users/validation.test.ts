import { describe, expect, it } from "vitest";
import { userCreationInputSchema, userUpdateInputSchema } from "@/modules/users/application/user-schemas";

const sectorId = "2a3bd10c-0f81-4c89-bf18-0e8991d7d402";

describe("user administration validation", () => {
  it("normalizes email and enforces exclusive role-sector assignments", () => {
    expect(
      userCreationInputSchema.parse({
        name: " Attendant ",
        email: " PERSON@EXAMPLE.TEST ",
        password: "secret",
        role: "ATTENDANT",
        sectorId,
      }),
    ).toMatchObject({
      name: "Attendant",
      email: "person@example.test",
      role: "ATTENDANT",
      sectorId,
    });
    expect(
      userCreationInputSchema.safeParse({
        name: "Requester",
        email: "requester@example.test",
        password: "secret",
        role: "REQUESTER",
        sectorId,
      }).success,
    ).toBe(false);
    expect(
      userCreationInputSchema.safeParse({
        name: "Attendant",
        email: "attendant@example.test",
        password: "secret",
        role: "ATTENDANT",
      }).success,
    ).toBe(false);
  });

  it("allows updates without a password but rejects empty passwords and unknown fields", () => {
    expect(
      userUpdateInputSchema.parse({
        name: "Admin",
        email: "admin@example.test",
        role: "ADMIN",
      }).sectorId,
    ).toBeNull();
    expect(
      userUpdateInputSchema.safeParse({
        name: "Admin",
        email: "admin@example.test",
        password: "",
        role: "ADMIN",
      }).success,
    ).toBe(false);
    expect(
      userCreationInputSchema.safeParse({
        name: "Admin",
        email: "admin@example.test",
        password: "secret",
        role: "ADMIN",
        isActive: false,
      }).success,
    ).toBe(false);
  });
});
