import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as useCases from "./application/service-field-use-cases";
import type { ServiceFieldRecord } from "./domain/service-field";
import {
  createPrismaServiceFieldRepository,
  createPrismaServiceFieldTransactionRunner,
} from "./infrastructure/prisma-service-field-repository";

// Public API of the custom fields module (SPEC 2026-11-01-campos-personalizados).

export {
  MAX_ACTIVE_SERVICE_FIELDS,
  SERVICE_FIELD_LIMITS,
  SERVICE_FIELD_TYPES,
  assertCanAddActiveField,
  assertFieldTypeUnchanged,
} from "./domain/service-field";
export type { ServiceFieldDefinition, ServiceFieldRecord, ServiceFieldType } from "./domain/service-field";
export { collectFieldAnswers, normalizeFieldValue } from "./domain/field-value";
export type {
  AnswerableField,
  FieldAnswer,
  FieldAnswerError,
  FieldAnswersResult,
  FieldValueErrorCode,
  FieldValueResult,
} from "./domain/field-value";
export { serviceFieldInputSchema } from "./application/service-field-schemas";
export type { ServiceFieldInput } from "./application/service-field-schemas";

export async function listServiceFields(database: PrismaClient = prisma): Promise<ServiceFieldRecord[]> {
  return useCases.listServiceFields(createPrismaServiceFieldRepository(database));
}

export async function createServiceField(
  serviceId: unknown,
  input: unknown,
  database: PrismaClient = prisma,
): Promise<ServiceFieldRecord> {
  return useCases.createServiceField(serviceId, input, createPrismaServiceFieldTransactionRunner(database));
}

export async function updateServiceField(
  fieldId: unknown,
  input: unknown,
  database: PrismaClient = prisma,
): Promise<ServiceFieldRecord> {
  return useCases.updateServiceField(fieldId, input, createPrismaServiceFieldTransactionRunner(database));
}

export async function moveServiceField(
  fieldId: unknown,
  direction: unknown,
  database: PrismaClient = prisma,
): Promise<void> {
  return useCases.moveServiceField(fieldId, direction, createPrismaServiceFieldTransactionRunner(database));
}

export async function deactivateServiceField(
  fieldId: unknown,
  database: PrismaClient = prisma,
): Promise<ServiceFieldRecord> {
  return useCases.deactivateServiceField(fieldId, createPrismaServiceFieldTransactionRunner(database));
}

export async function reactivateServiceField(
  fieldId: unknown,
  database: PrismaClient = prisma,
): Promise<ServiceFieldRecord> {
  return useCases.reactivateServiceField(fieldId, createPrismaServiceFieldTransactionRunner(database));
}
