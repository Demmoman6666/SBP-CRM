-- Mark any customer with at least one processed order as CUSTOMER
UPDATE "Customer" c
SET "stage" = 'CUSTOMER'
WHERE "stage" <> 'CUSTOMER'
  AND EXISTS (
    SELECT 1
    FROM "Order" o
    WHERE o."customerId" = c."id"
      AND o."processedAt" IS NOT NULL
      -- Optional: ensure it was a paid order
      -- AND COALESCE(o."total", 0) > 0
  );
