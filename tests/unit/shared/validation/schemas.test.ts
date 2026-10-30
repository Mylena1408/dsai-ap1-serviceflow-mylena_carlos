import { describe, expect, it } from "vitest";
import {
  activeStateInputSchema,
  entityIdSchema,
  emailSchema,
  nameSchema,
} from "../../../../src/shared/validation";
import { categoryInputSchema } from "../../../../src/modules/categories/application/category-schemas";
import {
  requestCreationInputSchema,
  requestStatusTransitionInputSchema,
} from "../../../../src/modules/requests/application/request-schemas";
import { sectorInputSchema } from "../../../../src/modules/sectors/application/sector-schemas";
import { serviceInputSchema } from "../../../../src/modules/services/application/service-schemas";
import { userProfileInputSchema } from "../../../../src/modules/users/application/user-schemas";
import { validateInput } from "../../../../src/server/validation";

const validUuid = "2a3bd10c-0f81-4c89-bf18-0e8991d7d402";

describe("shared input schemas", () => {
  it("trims names and rejects empty names", () => {
    expect(nameSchema.parse("  Sector name  ")).toBe("Sector name");
    expect(nameSchema.safeParse("   ").success).toBe(false);
  });

  it("validates entity identifiers and explicit active-state form values", () => {
    expect(entityIdSchema.safeParse(validUuid).success).toBe(true);
    expect(entityIdSchema.safeParse("not-a-uuid").success).toBe(false);
    expect(activeStateInputSchema.parse("true")).toBe(true);
    expect(activeStateInputSchema.parse("false")).toBe(false);
    expect(activeStateInputSchema.safeParse("yes").success).toBe(false);
  });

  it("normalizes email addresses before validation", () => {
    expect(emailSchema.parse("  Person@Example.COM ")).toBe("person@example.com");
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
  });

  it("accepts valid profile-sector combinations and normalizes absent sectors", () => {
    expect(userProfileInputSchema.parse({ role: "ATTENDANT", sectorId: validUuid })).toEqual({
      role: "ATTENDANT",
      sectorId: validUuid,
    });
    expect(userProfileInputSchema.parse({ role: "REQUESTER" })).toEqual({
      role: "REQUESTER",
      sectorId: null,
    });
    expect(userProfileInputSchema.parse({ role: "ADMIN", sectorId: null })).toEqual({
      role: "ADMIN",
      sectorId: null,
    });
  });

  it("rejects profile-sector mismatches and unknown fields", () => {
    expect(userProfileInputSchema.safeParse({ role: "ATTENDANT" }).success).toBe(false);
    expect(
      userProfileInputSchema.safeParse({ role: "REQUESTER", sectorId: validUuid }).success,
    ).toBe(false);
    expect(
      userProfileInputSchema.safeParse({ role: "ADMIN", isActive: true }).success,
    ).toBe(false);
  });

  it("validates sector and category names and rejects injected fields", () => {
    expect(sectorInputSchema.parse({ name: "  Operations " })).toEqual({ name: "Operations" });
    expect(categoryInputSchema.parse({ name: "  General " })).toEqual({ name: "General" });
    expect(sectorInputSchema.safeParse({ name: "Sector", isActive: false }).success).toBe(false);
  });

  it("validates service names, descriptions, and relation identifiers", () => {
    expect(
      serviceInputSchema.parse({
        name: "Service",
        description: " Service details ",
        categoryId: validUuid,
        sectorId: validUuid,
      }),
    ).toEqual({
      name: "Service",
      description: "Service details",
      categoryId: validUuid,
      sectorId: validUuid,
    });
    expect(
      serviceInputSchema.safeParse({
        name: "Service",
        description: "Details",
        categoryId: "invalid",
        sectorId: validUuid,
      }).success,
    ).toBe(false);
  });

  it("validates request input and enforces the server-side description limit", () => {
    expect(
      requestCreationInputSchema.parse({
        serviceId: validUuid,
        description: "  Need help  ",
      }),
    ).toEqual({ serviceId: validUuid, description: "Need help" });
    expect(
      requestCreationInputSchema.safeParse({
        serviceId: validUuid,
        description: " ".repeat(3),
      }).success,
    ).toBe(false);
    expect(
      requestCreationInputSchema.safeParse({
        serviceId: validUuid,
        description: "x".repeat(10_001),
      }).success,
    ).toBe(false);
    expect(
      requestCreationInputSchema.safeParse({
        serviceId: validUuid,
        description: "x".repeat(10_000),
      }).success,
    ).toBe(true);
    expect(
      requestCreationInputSchema.safeParse({
        serviceId: validUuid,
        description: "Valid description",
        status: "COMPLETED",
        requesterId: validUuid,
      }).success,
    ).toBe(false);
  });

  it("enforces schemas through the server validation helper", () => {
    expect(() =>
      validateInput(requestCreationInputSchema, {
        serviceId: validUuid,
        description: "",
      }),
    ).toThrow("The submitted input is invalid.");
  });

  it("validates explicit request transition targets and rejects protected fields", () => {
    expect(
      requestStatusTransitionInputSchema.parse({
        requestId: validUuid,
        toStatus: "IN_PROGRESS",
      }),
    ).toEqual({ requestId: validUuid, toStatus: "IN_PROGRESS" });
    expect(
      requestStatusTransitionInputSchema.safeParse({
        requestId: validUuid,
        toStatus: "OPEN",
      }).success,
    ).toBe(false);
    expect(
      requestStatusTransitionInputSchema.safeParse({
        requestId: validUuid,
        toStatus: "COMPLETED",
        actorId: validUuid,
      }).success,
    ).toBe(false);
  });
});
