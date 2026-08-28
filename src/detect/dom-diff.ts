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
  style: {
    color: string;
    backgroundColor: string;
    fontWeight: string;
    borderRadius: string;
    opacity: string;
    boxShadow: string;
    border: string;
  };
}

export interface RectDelta {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

export interface DomChange {
  path: string;
  id: string;
  rect: { x: number; y: number; w: number; h: number };
  changedFields: string[];
  /** after − before rect delta; present whenever changedFields includes "position" or "size" */
  rectDelta?: RectDelta;
  /** before/after values for each changed property (text or computed style); lets the
   *  deterministic describer render "blue → red" without a VLM call */
  values?: Record<string, FieldChange>;
}

export interface FieldChange {
  before: string;
  after: string;
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

function rectDeltaOf(b: DomNode["rect"], a: DomNode["rect"]): RectDelta {
  return { dx: a.x - b.x, dy: a.y - b.y, dw: a.w - b.w, dh: a.h - b.h };
}

/** Decompose a rect delta into position (x/y moved) and size (w/h changed) fields. */
export function rectDeltaFields(d: RectDelta): string[] {
  const fields: string[] = [];
  if (Math.abs(d.dx) > RECT_TOLERANCE_PX || Math.abs(d.dy) > RECT_TOLERANCE_PX) fields.push("position");
  if (Math.abs(d.dw) > RECT_TOLERANCE_PX || Math.abs(d.dh) > RECT_TOLERANCE_PX) fields.push("size");
  return fields;
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
      // node added or removed — carry the surviving side's text so the
      // deterministic describer can name the added/removed element
      const ref = a ?? b!;
      const values: Record<string, FieldChange> = {};
      if (ref.text) values.text = { before: !b ? "" : ref.text, after: !b ? ref.text : "" };
      changes.push({
        path,
        id: ref.id,
        rect: ref.rect,
        changedFields: [!b ? "added" : "removed"],
        ...(Object.keys(values).length > 0 ? { values } : {}),
      });
      continue;
    }

    const changedFields: string[] = [];
    const values: Record<string, FieldChange> = {};
    let rectDelta: RectDelta | undefined;
    if (rectChanged(b.rect, a.rect)) {
      rectDelta = rectDeltaOf(b.rect, a.rect);
      changedFields.push(...rectDeltaFields(rectDelta));
    }
    if (b.text !== a.text) {
      changedFields.push("text");
      values.text = { before: b.text, after: a.text };
    }
    if (b.style.color !== a.style.color) {
      changedFields.push("color");
      values.color = { before: b.style.color, after: a.style.color };
    }
    if (b.style.backgroundColor !== a.style.backgroundColor) {
      changedFields.push("backgroundColor");
      values.backgroundColor = { before: b.style.backgroundColor, after: a.style.backgroundColor };
    }
    if (b.style.fontWeight !== a.style.fontWeight) {
      changedFields.push("fontWeight");
      values.fontWeight = { before: b.style.fontWeight, after: a.style.fontWeight };
    }
    if (b.style.borderRadius !== a.style.borderRadius) {
      changedFields.push("borderRadius");
      values.borderRadius = { before: b.style.borderRadius, after: a.style.borderRadius };
    }
    if (b.style.opacity !== a.style.opacity) {
      changedFields.push("opacity");
      values.opacity = { before: b.style.opacity, after: a.style.opacity };
    }
    if (b.style.boxShadow !== a.style.boxShadow) {
      changedFields.push("boxShadow");
      values.boxShadow = { before: b.style.boxShadow, after: a.style.boxShadow };
    }
    if (b.style.border !== a.style.border) {
      changedFields.push("border");
      values.border = { before: b.style.border, after: a.style.border };
    }

    if (changedFields.length > 0) {
      changes.push({
        path,
        id: a.id,
        rect: a.rect,
        changedFields,
        ...(rectDelta ? { rectDelta } : {}),
        ...(Object.keys(values).length > 0 ? { values } : {}),
      });
    }
  }

  return changes;
}
