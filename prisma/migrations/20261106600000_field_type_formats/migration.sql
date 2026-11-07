-- SPEC 2026-11-06-aprofundamento-configurabilidade, seção 3.4. Additive.
-- Only the new enum values: PostgreSQL does not allow using a value added in the same
-- transaction, so the constraint that mentions DECIMAL comes in the next migration (as
-- 20261103500000_field_type_multi_select).

-- AlterEnum
ALTER TYPE "public"."ServiceFieldType" ADD VALUE 'DECIMAL';
ALTER TYPE "public"."ServiceFieldType" ADD VALUE 'EMAIL';
ALTER TYPE "public"."ServiceFieldType" ADD VALUE 'PHONE';
ALTER TYPE "public"."ServiceFieldType" ADD VALUE 'CPF';
ALTER TYPE "public"."ServiceFieldType" ADD VALUE 'CNPJ';
ALTER TYPE "public"."ServiceFieldType" ADD VALUE 'CEP';
