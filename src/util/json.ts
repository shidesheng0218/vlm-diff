// Shared extraction for the "strict JSON, no markdown fences" contract every
// model prompt uses. Previously copy-pasted in four call sites.

/** Strip markdown fences/leading prose and parse the first JSON object in `text`. */
export function extractJson(text: string): unknown | undefined {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    // models sometimes wrap the JSON in prose; grab the first balanced object
    const start = cleaned.indexOf("{");
    if (start === -1) return undefined;
    let depth = 0;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(cleaned.slice(start, i + 1));
          } catch {
            return undefined;
          }
        }
      }
    }
    return undefined;
  }
}
