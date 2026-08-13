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

export const MUTATIONS: Mutation[] = [
  {
    id: "spatial-shift-small",
    kind: "spatial-shift",
    magnitude: "small",
    selector: "#card-2, #email, #link-2",
    description: "shift target element by 6px via margin-left",
    apply: (sel) => {
      document.querySelectorAll(sel!).forEach((el) => {
        (el as HTMLElement).style.marginLeft = "6px";
      });
    },
  },
  {
    id: "spatial-shift-large",
    kind: "spatial-shift",
    magnitude: "large",
    selector: "#card-2, #email, #link-2",
    description: "shift target element by 28px via margin-left",
    apply: (sel) => {
      document.querySelectorAll(sel!).forEach((el) => {
        (el as HTMLElement).style.marginLeft = "28px";
      });
    },
  },
  {
    id: "color-change-small",
    kind: "color-change",
    magnitude: "small",
    selector: ".btn, .submit, .cta",
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
    selector: ".btn, .submit, .cta",
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
    selector: "#card-1, #name, .logo",
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
    selector: "#card-1, #name, .logo",
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
    selector: "#card-1 h3, #name, #link-1",
    description: "replace text content with a similarly-lengthed alternative",
    apply: (sel) => {
      const map: Record<string, string> = { H3: "Project Falcan", INPUT: "Jordan Reyas", A: "Product+" };
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
    selector: "#card-1 h3, #name, #link-1",
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
    selector: "#grid, #form, #links",
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
    selector: "#grid, #form, #links",
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
    selector: "#card-1 h3, .submit, .logo",
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
    selector: ".card, .btn, .cta, .submit",
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
