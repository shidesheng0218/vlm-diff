// Mutation taxonomy, loosely aligned with VLM-SubtleBench's category axes
// (spatial, color, size, text, add/remove, style) plus a "none" category
// for no-change pairs — the class where naive pixel diff reports high
// false-positive rates due to anti-aliasing/render-timing noise.

export type MutationKind =
  | "spatial-shift"
  | "color-change"
  | "size-change"
  | "text-change"
  | "element-add"
  | "element-remove"
  | "style-change"
  | "none";

export interface Mutation {
  id: string;
  kind: MutationKind;
  /** magnitude bucket, used to stratify the dataset (small vs large changes) */
  magnitude: "small" | "large";
  /** CSS selector of the element this mutation targets (absent for "none") */
  selector?: string;
  /** human-readable description of exactly what was mutated, used as ground truth */
  description: string;
  /** JS run in the page context (via page.evaluate) to apply the mutation */
  apply: (selector: string | undefined) => void;
}

// NOTE: `apply` bodies are serialized via toString() and re-executed inside
// the page context by dataset/generate.ts (Playwright's page.evaluate takes
// a function, not a closure over Node-side state), so they must be
// self-contained: no references to outer scope beyond their own parameter.
//
// Spatial shifts try margin first, then fall back to a transform if the rect
// didn't actually move. Margins are the semantically honest way to move an
// element (they push siblings, like a real layout regression) but silently
// no-op on inline elements (<a>), table cells, flex items whose free space is
// consumed by justify-content, and collapsed vertical margins — a naive
// marginLeft produces a DOM-identical pair in those fixtures. The transform
// fallback keeps every spatial mutation both pixel- and DOM-observable; the
// DOM diff tracks `transform` as a changed field (see snapshotDom).

// Newer mutations target different elements in different fixtures, so the
// selector is resolved per-fixture from this map (keyed by fixture filename).
// The legacy mutations below use a single multi-target selector and rely on
// non-matching selectors simply matching nothing.
export interface TargetedMutation extends Mutation {
  targets: Record<string, string>;
}

export function isTargeted(m: Mutation): m is TargetedMutation {
  return "targets" in m;
}

/** Self-contained page-context helper: shift by `px` along `axis`, margin-first with transform fallback. Serialized inline by toString(). */
function shiftPx(sel: string | undefined, px: number, axis: "x" | "y"): void {
  document.querySelectorAll(sel!).forEach((el) => {
    const h = el as HTMLElement;
    const before = el.getBoundingClientRect();
    if (axis === "x") h.style.marginLeft = `${px}px`;
    else h.style.marginTop = `${px}px`;
    const after = el.getBoundingClientRect();
    if (Math.abs(axis === "x" ? after.x - before.x : after.y - before.y) < 1) {
      h.style.transform = axis === "x" ? `translateX(${px}px)` : `translateY(${px}px)`;
    }
  });
}

export const MUTATIONS: Mutation[] = [
  {
    id: "spatial-shift-small",
    kind: "spatial-shift",
    magnitude: "small",
    selector: "#card-2, #email, #link-2, #row-1 td:first-child, #btn-cancel, #stat-1",
    description: "shift target element by 6px (margin-left, transform fallback)",
    apply: (sel) => {
      document.querySelectorAll(sel!).forEach((el) => {
        const h = el as HTMLElement;
        const x0 = el.getBoundingClientRect().x;
        h.style.marginLeft = "6px";
        if (Math.abs(el.getBoundingClientRect().x - x0) < 1) h.style.transform = "translateX(6px)";
      });
    },
  },
  {
    id: "spatial-shift-large",
    kind: "spatial-shift",
    magnitude: "large",
    selector: "#card-2, #email, #link-2, #row-1 td:first-child, #btn-cancel, #stat-1",
    description: "shift target element by 28px (margin-left, transform fallback)",
    apply: (sel) => {
      document.querySelectorAll(sel!).forEach((el) => {
        const h = el as HTMLElement;
        const x0 = el.getBoundingClientRect().x;
        h.style.marginLeft = "28px";
        if (Math.abs(el.getBoundingClientRect().x - x0) < 1) h.style.transform = "translateX(28px)";
      });
    },
  },
  {
    id: "color-change-small",
    kind: "color-change",
    magnitude: "small",
    selector: ".btn, .submit, .cta, #new-deploy, .btn-primary, #bars .bar:nth-child(4)",
    description: "shift accent color by a small hue delta (low contrast difference)",
    apply: (sel) => {
      document.querySelectorAll(sel!).forEach((el) => {
        (el as HTMLElement).style.backgroundColor = "#3b6fe0";
      });
    },
  },
  {
    id: "color-change-large",
    kind: "color-change",
    magnitude: "large",
    selector: ".btn, .submit, .cta, #new-deploy, .btn-primary, #bars .bar:nth-child(4)",
    description: "change accent color to a high-contrast complementary color",
    apply: (sel) => {
      document.querySelectorAll(sel!).forEach((el) => {
        (el as HTMLElement).style.backgroundColor = "#dc2626";
      });
    },
  },
  {
    id: "size-change-small",
    kind: "size-change",
    magnitude: "small",
    selector: "#card-1, #name, .logo, #row-2, #modal, #users-value",
    description: "resize target element by +10% width/height",
    apply: (sel) => {
      document.querySelectorAll(sel!).forEach((el) => {
        const h = el as HTMLElement;
        h.style.transform = "scale(1.1)";
        h.style.transformOrigin = "top left";
      });
    },
  },
  {
    id: "size-change-large",
    kind: "size-change",
    magnitude: "large",
    selector: "#card-1, #name, .logo, #row-2, #modal, #users-value",
    description: "resize target element by +35% width/height",
    apply: (sel) => {
      document.querySelectorAll(sel!).forEach((el) => {
        const h = el as HTMLElement;
        h.style.transform = "scale(1.35)";
        h.style.transformOrigin = "top left";
      });
    },
  },
  {
    id: "text-change-similar",
    kind: "text-change",
    magnitude: "small",
    selector: "#card-1 h3, #name, #link-1, #row-1 .ver, #modal-title, #rev-delta",
    description: "replace text content with a similarly-lengthed alternative",
    apply: (sel) => {
      const map: Record<string, string> = { H3: "Project Falcan", INPUT: "Jordan Reyas", A: "Product+", H2: "Delete project!", TD: "v2.14.1", DIV: "+12.9%" };
      document.querySelectorAll(sel!).forEach((el) => {
        if (el.tagName === "INPUT") (el as HTMLInputElement).value = map[el.tagName] ?? "Changed";
        else el.textContent = map[el.tagName] ?? "Changed";
      });
    },
  },
  {
    id: "text-change-different",
    kind: "text-change",
    magnitude: "large",
    selector: "#card-1 h3, #name, #link-1, #row-1 .ver, #modal-title, #rev-delta",
    description: "replace text content with a substantially different string",
    apply: (sel) => {
      document.querySelectorAll(sel!).forEach((el) => {
        if (el.tagName === "INPUT") (el as HTMLInputElement).value = "A completely different value here";
        else el.textContent = "Totally different label";
      });
    },
  },
  {
    id: "element-add",
    kind: "element-add",
    magnitude: "large",
    selector: "#grid, #form, #links, #deploy-rows, #modal-actions, #cards",
    description: "insert a new sibling element into the container",
    apply: (sel) => {
      const container = document.querySelector(sel!);
      if (!container) return;
      const clone = container.children[0]?.cloneNode(true) as HTMLElement | undefined;
      if (clone) container.appendChild(clone);
    },
  },
  {
    id: "element-remove",
    kind: "element-remove",
    magnitude: "large",
    selector: "#grid, #form, #links, #deploy-rows, #modal-actions, #cards",
    description: "remove the last child element from the container",
    apply: (sel) => {
      const container = document.querySelector(sel!);
      if (container && container.children.length > 0) {
        container.removeChild(container.children[container.children.length - 1]);
      }
    },
  },
  {
    id: "style-change-weight",
    kind: "style-change",
    magnitude: "small",
    selector: "#card-1 h3, .submit, .logo, #deploys th:first-child, #modal-title, #rev-value",
    description: "change font-weight from bold to normal",
    apply: (sel) => {
      document.querySelectorAll(sel!).forEach((el) => {
        (el as HTMLElement).style.fontWeight = "400";
      });
    },
  },
  {
    id: "style-change-radius",
    kind: "style-change",
    magnitude: "large",
    selector: ".card, .btn, .cta, .submit, #new-deploy, .btn-primary, .stat",
    description: "change border-radius from rounded to square",
    apply: (sel) => {
      document.querySelectorAll(sel!).forEach((el) => {
        (el as HTMLElement).style.borderRadius = "0px";
      });
    },
  },
  {
    id: "none",
    kind: "none",
    magnitude: "small",
    description: "no DOM/CSS mutation — re-render only, to measure false-positive rate from anti-aliasing/timing noise",
    apply: () => {
      // intentionally a no-op
    },
  },
];

// ─── Mutation expansion (2026-08-24): +12 variants × 6 fixtures ───────────
// Same taxonomy axes, new elements/axes/directions/magnitudes. All of these
// resolve their target per fixture via `targets` (fixture filename → selector).

export const EXTRA_MUTATIONS: TargetedMutation[] = [
  {
    id: "spatial-shift-tiny",
    kind: "spatial-shift",
    magnitude: "small",
    targets: { "card-list.html": "#card-3", "form.html": "#team", "navbar.html": "#link-3", "table.html": "#row-3 td:first-child", "modal.html": "#btn-confirm", "dashboard.html": "#stat-2 .value" },
    description: "shift target element by 3px (margin-left, transform fallback)",
    apply: (sel) => {
      document.querySelectorAll(sel!).forEach((el) => {
        const h = el as HTMLElement;
        const x0 = el.getBoundingClientRect().x;
        h.style.marginLeft = "3px";
        if (Math.abs(el.getBoundingClientRect().x - x0) < 1) h.style.transform = "translateX(3px)";
      });
    },
  },
  {
    id: "spatial-shift-medium",
    kind: "spatial-shift",
    magnitude: "small",
    targets: { "card-list.html": "#card-3", "form.html": "#team", "navbar.html": "#link-3", "table.html": "#row-3 td:first-child", "modal.html": "#btn-confirm", "dashboard.html": "#stat-2 .value" },
    description: "shift target element by 12px (margin-left, transform fallback)",
    apply: (sel) => {
      document.querySelectorAll(sel!).forEach((el) => {
        const h = el as HTMLElement;
        const x0 = el.getBoundingClientRect().x;
        h.style.marginLeft = "12px";
        if (Math.abs(el.getBoundingClientRect().x - x0) < 1) h.style.transform = "translateX(12px)";
      });
    },
  },
  {
    id: "spatial-shift-vertical",
    kind: "spatial-shift",
    magnitude: "small",
    targets: { "card-list.html": "#card-2", "form.html": "#email", "navbar.html": "#link-2", "table.html": "#row-3 td:first-child", "dashboard.html": "#stat-2" },
    description: "shift target element down by 8px (margin-top, transform fallback)",
    apply: (sel) => {
      document.querySelectorAll(sel!).forEach((el) => {
        const h = el as HTMLElement;
        const y0 = el.getBoundingClientRect().y;
        h.style.marginTop = "8px";
        if (Math.abs(el.getBoundingClientRect().y - y0) < 1) h.style.transform = "translateY(8px)";
      });
    },
  },
  {
    id: "color-change-text",
    kind: "color-change",
    magnitude: "small",
    targets: { "card-list.html": "#card-1 h3", "form.html": "label", "navbar.html": "#link-1", "table.html": "th", "modal.html": "#modal-title", "dashboard.html": "#rev-value" },
    description: "change text color of the target",
    apply: (sel) => { document.querySelectorAll(sel!).forEach((el) => { (el as HTMLElement).style.color = "#dc2626"; }); },
  },
  {
    id: "color-change-border",
    kind: "color-change",
    magnitude: "small",
    targets: { "card-list.html": "#card-1", "form.html": "#name", "navbar.html": "#cta", "table.html": "#panel", "modal.html": "#modal", "dashboard.html": "#stat-1" },
    description: "add/alter the target's border color",
    apply: (sel) => { document.querySelectorAll(sel!).forEach((el) => { (el as HTMLElement).style.border = "2px solid #2563eb"; }); },
  },
  {
    id: "size-change-shrink",
    kind: "size-change",
    magnitude: "small",
    targets: { "card-list.html": "#card-2", "form.html": "#email", "navbar.html": ".logo", "table.html": "#new-deploy", "modal.html": "#modal", "dashboard.html": "#stat-2" },
    description: "shrink target element by 10% via scale(0.9)",
    apply: (sel) => { document.querySelectorAll(sel!).forEach((el) => { const h = el as HTMLElement; h.style.transform = "scale(0.9)"; h.style.transformOrigin = "top left"; }); },
  },
  {
    id: "size-change-grow-medium",
    kind: "size-change",
    magnitude: "small",
    targets: { "card-list.html": "#card-3", "form.html": "#team", "navbar.html": "#cta", "table.html": "#panel", "modal.html": "#modal", "dashboard.html": "#chart" },
    description: "resize target element by +20% via scale(1.2)",
    apply: (sel) => { document.querySelectorAll(sel!).forEach((el) => { const h = el as HTMLElement; h.style.transform = "scale(1.2)"; h.style.transformOrigin = "top left"; }); },
  },
  {
    id: "text-change-shorten",
    kind: "text-change",
    magnitude: "small",
    targets: { "card-list.html": "#card-2 h3", "form.html": "h2", "table.html": "#row-1 .svc", "modal.html": "#modal-title", "dashboard.html": "#stat-1 .label" },
    description: "shorten the target's text content (keep first half)",
    apply: (sel) => {
      document.querySelectorAll(sel!).forEach((el) => {
        const t = (el.textContent ?? "").trim();
        el.textContent = t.slice(0, Math.max(1, Math.ceil(t.length / 2)));
      });
    },
  },
  {
    id: "text-change-number",
    kind: "text-change",
    magnitude: "small",
    targets: { "card-list.html": "#card-1 h3", "form.html": "#team", "table.html": "#row-2 .err", "modal.html": "#modal-body", "dashboard.html": "#rev-value" },
    description: "change a numeric value (price/count/metric)",
    apply: (sel) => {
      const map: Record<string, string> = { H3: "Project Falcon 2", INPUT: "10-25 people", A: "Pricing+", TD: "23", P: "This will permanently remove the project and its 21 deployments. This action cannot be undone.", DIV: "$52,980" };
      document.querySelectorAll(sel!).forEach((el) => {
        const v = map[el.tagName] ?? "42";
        if (el.tagName === "INPUT") (el as HTMLInputElement).value = v; else el.textContent = v;
      });
    },
  },
  {
    id: "element-remove-first",
    kind: "element-remove",
    magnitude: "large",
    targets: { "card-list.html": "#grid", "form.html": "#form", "navbar.html": "#links", "table.html": "#deploy-rows", "modal.html": "#modal-actions", "dashboard.html": "#cards" },
    description: "remove the FIRST child element from the container",
    apply: (sel) => {
      const container = document.querySelector(sel!);
      if (container && container.children.length > 0) container.removeChild(container.children[0]);
    },
  },
  {
    id: "style-change-shadow",
    kind: "style-change",
    magnitude: "small",
    targets: { "card-list.html": "#card-1", "form.html": "#form", "navbar.html": "#nav", "table.html": "#panel", "modal.html": "#modal", "dashboard.html": "#stat-1" },
    description: "change the target's box-shadow",
    apply: (sel) => { document.querySelectorAll(sel!).forEach((el) => { (el as HTMLElement).style.boxShadow = "0 8px 24px rgba(37,99,235,0.35)"; }); },
  },
  {
    id: "style-change-opacity",
    kind: "style-change",
    magnitude: "small",
    targets: { "card-list.html": "#card-3", "form.html": "#submit", "table.html": "#row-4", "dashboard.html": "#chart" },
    description: "lower the target's opacity to 0.5",
    apply: (sel) => { document.querySelectorAll(sel!).forEach((el) => { (el as HTMLElement).style.opacity = "0.5"; }); },
  },
  {
    id: "none-b",
    kind: "none",
    magnitude: "small",
    targets: {},
    description: "no DOM/CSS mutation (second no-change sample per fixture)",
    apply: () => { /* no-op */ },
  },
  {
    id: "none-c",
    kind: "none",
    magnitude: "small",
    targets: {},
    description: "no DOM/CSS mutation (third no-change sample per fixture)",
    apply: () => { /* no-op */ },
  },
];
