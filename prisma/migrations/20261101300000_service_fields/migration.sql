-- SPEC 2026-11-01 (campos personalizados), seção 6. Additive only: existing services and requests get no fields.

-- CreateEnum
CREATE TYPE "public"."ServiceFieldType" AS ENUM ('SHORT_TEXT', 'LONG_TEXT', 'INTEGER', 'DATE', 'SELECT', 'YES_NO');

-- CreateTable
CREATE TABLE "public"."ServiceField" (
    "id" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "label" CITEXT NOT NULL,
    "helpText" TEXT,
    "type" "public"."ServiceFieldType" NOT NULL,
    "isRequired" BOOLEAN NOT NULL,
    "options" TEXT[],
    "minValue" INTEGER,
    "maxValue" INTEGER,
    "position" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ServiceField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RequestFieldValue" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "fieldId" UUID NOT NULL,
    "labelSnapshot" TEXT NOT NULL,
    "typeSnapshot" "public"."ServiceFieldType" NOT NULL,
    "positionSnapshot" INTEGER NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceField_serviceId_idx" ON "public"."ServiceField"("serviceId");

-- CreateIndex
CREATE INDEX "RequestFieldValue_fieldId_idx" ON "public"."RequestFieldValue"("fieldId");

-- CreateIndex
CREATE UNIQUE INDEX "RequestFieldValue_requestId_fieldId_key" ON "public"."RequestFieldValue"("requestId", "fieldId");

-- AddForeignKey
ALTER TABLE "public"."ServiceField" ADD CONSTRAINT "ServiceField_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "public"."Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestFieldValue" ADD CONSTRAINT "RequestFieldValue_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestFieldValue" ADD CONSTRAINT "RequestFieldValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "public"."ServiceField"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Field labels are unique per service among active fields, case-insensitively (citext) (SPEC 5.1).
CREATE UNIQUE INDEX "ServiceField_serviceId_label_active_key"
ON "public"."ServiceField" ("serviceId", "label")
WHERE "isActive" = true;

-- Options of a list field: trimmed, 1 to 80 characters each, no case-insensitive repeats (SPEC 5.2).
CREATE FUNCTION "public"."service_field_options_valid"(options TEXT[]) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(bool_and(item IS NOT NULL AND item = btrim(item) AND char_length(item) BETWEEN 1 AND 80), true)
     AND count(DISTINCT lower(item)) = count(*)
  FROM unnest(options) AS item
$$;

ALTER TABLE "public"."ServiceField"
ADD CONSTRAINT "ServiceField_label_check"
CHECK ("label" = btrim("label") AND char_length("label") BETWEEN 1 AND 80);

ALTER TABLE "public"."ServiceField"
ADD CONSTRAINT "ServiceField_helpText_check"
CHECK ("helpText" IS NULL OR ("helpText" = btrim("helpText") AND char_length("helpText") BETWEEN 1 AND 200));

-- Prisma creates scalar list columns as nullable; only list fields have options (2 to 20).
ALTER TABLE "public"."ServiceField"
ADD CONSTRAINT "ServiceField_options_check"
CHECK (
    "options" IS NOT NULL
    AND "public"."service_field_options_valid"("options")
    AND CASE WHEN "type" = 'SELECT' THEN cardinality("options") BETWEEN 2 AND 20
             ELSE cardinality("options") = 0 END
);

-- Limits only on integer fields, within +-1,000,000,000 and with min <= max.
ALTER TABLE "public"."ServiceField"
ADD CONSTRAINT "ServiceField_limits_check"
CHECK (
    ("type" = 'INTEGER' OR ("minValue" IS NULL AND "maxValue" IS NULL))
    AND ("minValue" IS NULL OR "minValue" BETWEEN -1000000000 AND 1000000000)
    AND ("maxValue" IS NULL OR "maxValue" BETWEEN -1000000000 AND 1000000000)
    AND ("minValue" IS NULL OR "maxValue" IS NULL OR "minValue" <= "maxValue")
);

ALTER TABLE "public"."ServiceField"
ADD CONSTRAINT "ServiceField_position_check"
CHECK ("position" >= 0);

-- Answers: blank optional fields produce no row; long text is the largest value (2,000 characters).
ALTER TABLE "public"."RequestFieldValue"
ADD CONSTRAINT "RequestFieldValue_value_check"
CHECK (char_length("value") BETWEEN 1 AND 2000);

ALTER TABLE "public"."RequestFieldValue"
ADD CONSTRAINT "RequestFieldValue_snapshot_check"
CHECK (char_length("labelSnapshot") BETWEEN 1 AND 80 AND "positionSnapshot" >= 0);
