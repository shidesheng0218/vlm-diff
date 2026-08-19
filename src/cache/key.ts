// Content-addressed cache key: identical crop pixels always classify to the
// same result, so hashing the crop bytes (rather than a separate DOM hash)
// is sufficient and requires no extra bookkeeping.

import { createHash } from "node:crypto";

export function computeCacheKey(beforeCrop: Buffer, afterCrop: Buffer, promptContext?: string): string {
  const hash = createHash("sha256").update(beforeCrop).update(afterCrop);
  // Prompt-affecting context (e.g. DOM-field hints) must be part of the key:
  // same pixels + different hint can yield a different classification.
  if (promptContext) hash.update(promptContext);
  return hash.digest("hex");
}
