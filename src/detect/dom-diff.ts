// Structural DOM diff: the UI-domain-specific strong signal. Compares two
// DOM snapshots (see dataset/generate.ts snapshotDom) node-by-node via their
// positional path, and reports which nodes changed and how.

export interface DomNode {
  path: string;
  tag: string;
  id: string;
  className: string;
  text: string;
  rect: { x: number; y: number; w: number; h: number };
  style: { color: string; backgroundColor: string; fontWeight: string; borderRadius: string };
}

export interface DomChange {
  path: string;
  id: string;
  rect: { x: number; y: number; w: number; h: number };
  changedFields: string[];
}

export function parseSnapshot(json: string): DomNode[] {
  return JSON.parse(json) as DomNode[];
}

const RECT_TOLERANCE_PX = 1; // sub-pixel layout jitter, not a real change

function rectChanged(a: DomNode["rect"], b: DomNode["rect"]): boolean {
  return (
    Math.abs(a.x - b.x) > RECT_TOLERANCE_PX ||
    Math.abs(a.y - b.y) > RECT_TOLERANCE_PX ||
    Math.abs(a.w - b.w) > RECT_TOLERANCE_PX ||
    Math.abs(a.h - b.h) > RECT_TOLERANCE_PX
  );
}

/** Diff two DOM snapshots. Returns one DomChange per node whose text, rect, or style differs. */
export function diffDom(before: DomNode[], after: DomNode[]): DomChange[] {
  const beforeByPath = new Map(before.map((n) => [n.path, n]));
  const afterByPath = new Map(after.map((n) => [n.path, n]));
  const changes: DomChange[] = [];

  const allPaths = new Set([...beforeByPath.keys(), ...afterByPath.keys()]);
  for (const path of allPaths) {
    const b = beforeByPath.get(path);
    const a = afterByPath.get(path);

    if (!b || !a) {
      // node added or removed
      const ref = a ?? b!;
      changes.push({ path, id: ref.id, rect: ref.rect, changedFields: [!b ? "added" : "removed"] });
      continue;
    }

    const changedFields: string[] = [];
    if (rectChanged(b.rect, a.rect)) changedFields.push("rect");
    if (b.text !== a.text) changedFields.push("text");
    if (b.style.color !== a.style.color) changedFields.push("color");
    if (b.style.backgroundColor !== a.style.backgroundColor) changedFields.push("backgroundColor");
    if (b.style.fontWeight !== a.style.fontWeight) changedFields.push("fontWeight");
    if (b.style.borderRadius !== a.style.borderRadius) changedFields.push("borderRadius");

    if (changedFields.length > 0) {
      changes.push({ path, id: a.id, rect: a.rect, changedFields });
    }
  }

  return changes;
}
