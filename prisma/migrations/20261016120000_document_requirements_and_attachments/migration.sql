-- SPEC section 21 (2026-10-16): per-service document requirements and request attachment metadata.
-- Additive only: no existing table, column, or row is changed and no data is inserted.

-- CreateEnum
CREATE TYPE "public"."DocumentFormat" AS ENUM ('PDF', 'DOCX', 'TXT');

-- CreateTable
CREATE TABLE "public"."ServiceDocumentRequirement" (
    "id" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "name" CITEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL,
    "acceptedFormats" "public"."DocumentFormat"[],
    "position" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ServiceDocumentRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RequestAttachment" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "requirementNameSnapshot" TEXT NOT NULL,
    "requirementRequiredSnapshot" BOOLEAN NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "detectedFormat" "public"."DocumentFormat" NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceDocumentRequirement_serviceId_idx" ON "public"."ServiceDocumentRequirement"("serviceId");

-- CreateIndex
CREATE INDEX "RequestAttachment_requirementId_idx" ON "public"."RequestAttachment"("requirementId");

-- CreateIndex
CREATE INDEX "RequestAttachment_uploadedById_idx" ON "public"."RequestAttachment"("uploadedById");

-- CreateIndex
CREATE UNIQUE INDEX "RequestAttachment_requestId_requirementId_key" ON "public"."RequestAttachment"("requestId", "requirementId");

-- AddForeignKey
ALTER TABLE "public"."ServiceDocumentRequirement" ADD CONSTRAINT "ServiceDocumentRequirement_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "public"."Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestAttachment" ADD CONSTRAINT "RequestAttachment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestAttachment" ADD CONSTRAINT "RequestAttachment_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "public"."ServiceDocumentRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestAttachment" ADD CONSTRAINT "RequestAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Requirement names are unique per service among active requirements, case-insensitively (citext).
CREATE UNIQUE INDEX "ServiceDocumentRequirement_serviceId_name_active_key"
ON "public"."ServiceDocumentRequirement" ("serviceId", "name")
WHERE "isActive" = true;

ALTER TABLE "public"."ServiceDocumentRequirement"
ADD CONSTRAINT "ServiceDocumentRequirement_name_check"
CHECK ("name" = btrim("name") AND char_length("name") BETWEEN 1 AND 120);

-- Prisma creates scalar list columns as nullable; the CHECK requires a non-empty list without NULL items.
ALTER TABLE "public"."ServiceDocumentRequirement"
ADD CONSTRAINT "ServiceDocumentRequirement_acceptedFormats_check"
CHECK (
    "acceptedFormats" IS NOT NULL
    AND cardinality("acceptedFormats") BETWEEN 1 AND 3
    AND array_position("acceptedFormats", NULL) IS NULL
);

ALTER TABLE "public"."ServiceDocumentRequirement"
ADD CONSTRAINT "ServiceDocumentRequirement_position_check"
CHECK ("position" >= 0);

ALTER TABLE "public"."RequestAttachment"
ADD CONSTRAINT "RequestAttachment_requirementNameSnapshot_check"
CHECK (char_length("requirementNameSnapshot") BETWEEN 1 AND 120);

-- Sanitized names only: 1 to 255 characters, without path separators or control characters.
ALTER TABLE "public"."RequestAttachment"
ADD CONSTRAINT "RequestAttachment_originalFilename_check"
CHECK (
    char_length("originalFilename") BETWEEN 1 AND 255
    AND "originalFilename" !~ '[/\\[:cntrl:]]'
);

-- Content type is derived from the detected format, never from the client.
ALTER TABLE "public"."RequestAttachment"
ADD CONSTRAINT "RequestAttachment_contentType_check"
CHECK (
    ("detectedFormat" = 'PDF' AND "contentType" = 'application/pdf')
    OR ("detectedFormat" = 'DOCX' AND "contentType" = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    OR ("detectedFormat" = 'TXT' AND "contentType" = 'text/plain')
);

-- Empty files are rejected; 2 MiB per file (SPEC 21.6).
ALTER TABLE "public"."RequestAttachment"
ADD CONSTRAINT "RequestAttachment_sizeBytes_check"
CHECK ("sizeBytes" BETWEEN 1 AND 2097152);

ALTER TABLE "public"."RequestAttachment"
ADD CONSTRAINT "RequestAttachment_sha256_check"
CHECK ("sha256" ~ '^[0-9a-f]{64}$');

-- Opaque key derived from server-generated identifiers (SPEC 21.15.4); unique because "id" is the primary key.
ALTER TABLE "public"."RequestAttachment"
ADD CONSTRAINT "RequestAttachment_storageKey_check"
CHECK ("storageKey" = 'requests/' || "requestId"::text || '/' || "id"::text);
