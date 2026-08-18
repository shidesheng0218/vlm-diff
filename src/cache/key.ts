// Content-addressed cache key: identical crop pixels always classify to the
// same result, so hashing the crop bytes (rather than a separate DOM hash)
// is sufficient and requires no extra bookkeeping.

import { createHash } from "node:crypto";

export function computeCacheKey(beforeCrop: Buffer, afterCrop: Buffer): string {
  return createHash("sha256").update(beforeCrop).update(afterCrop).digest("hex");
}
