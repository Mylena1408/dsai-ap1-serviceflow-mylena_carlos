-- SPEC 2026-11-06-aprofundamento-configurabilidade, seções 3.3.1 e 3.4. Additive: three nullable
-- columns and one new constraint; existing fields keep the columns null and pass the check.

-- AlterTable
ALTER TABLE "public"."ServiceField" ADD COLUMN     "decimalPlaces" INTEGER,
ADD COLUMN     "maxDecimal" DECIMAL(14,4),
ADD COLUMN     "minDecimal" DECIMAL(14,4);

-- Places exactly on decimal fields (1 to 4); decimal limits only on them, within
-- +-1,000,000,000, with no more places than the field and min <= max. The IS NOT NULL tests are
-- explicit: a CHECK whose result is NULL passes.
ALTER TABLE "public"."ServiceField"
ADD CONSTRAINT "ServiceField_decimal_check"
CHECK (
    (("type" = 'DECIMAL') = ("decimalPlaces" IS NOT NULL))
    AND ("decimalPlaces" IS NULL OR "decimalPlaces" BETWEEN 1 AND 4)
    AND ("type" = 'DECIMAL' OR ("minDecimal" IS NULL AND "maxDecimal" IS NULL))
    AND ("minDecimal" IS NULL OR (
        "minDecimal" BETWEEN -1000000000 AND 1000000000
        AND "minDecimal" = round("minDecimal", "decimalPlaces")
    ))
    AND ("maxDecimal" IS NULL OR (
        "maxDecimal" BETWEEN -1000000000 AND 1000000000
        AND "maxDecimal" = round("maxDecimal", "decimalPlaces")
    ))
    AND ("minDecimal" IS NULL OR "maxDecimal" IS NULL OR "minDecimal" <= "maxDecimal")
);
