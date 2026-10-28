"use client";

// English screen. Most UI text is translated where it is rendered (t() / getT()); this catches the rest in place, after
// hydration, and keeps doing it as pages change (MutationObserver — it runs before the browser paints the change):
//   1. Bangla UI text → English from the dictionary (src/lib/screen-translate.ts): text, placeholders, titles,
//      aria-labels, button values, <option>s and the tab title. The business's own data (names, notes) has no key and
//      stays as written.
//   2. Numbers with English digits and dates with English month names (amounts, quantities and dates are formatted the
//      Bangla way on the server, src/lib/format.ts):
//      "২৮ অক্টোবর ২০২৬" → "28 October 2026", "৳ ১২,৫০০.০০" → "৳ 12,500.00". A month name is changed only in a date
//      (followed by a year), so words that merely contain one ("মেয়াদ") stay.
// Form fields keep exactly what the user typed. data-keep-lang leaves an element (and everything inside it) untouched;
// data-keep-digits keeps its digits. While the first pass runs the page stays hidden (html[data-lang-pending],
// globals.css — shown anyway after 1.5 s), so English pages do not flash Bangla on load.
import { useEffect } from "react";
import { hasBanglaDigits, toAsciiDigits } from "@/lib/digits";
import { MONTH_NAMES } from "@/lib/format";
import { MONTHS_EN } from "@/lib/i18n";
import { screenTranslator, translateTitle } from "@/lib/screen-translate";
import { useDict } from "@/components/lang";

const MONTH_IN_DATE = new RegExp(`(${MONTH_NAMES.join("|")})(?=\\s+[0-9০-৯]{4})`, "g");
const toEnglish = (v: string) => toAsciiDigits(v).replace(MONTH_IN_DATE, (m) => MONTHS_EN[MONTH_NAMES.indexOf(m)] ?? m);
const HAS_MONTH_IN_DATE = new RegExp(MONTH_IN_DATE.source); // no "g": .test() must not keep a lastIndex
const needs = (v: string) => hasBanglaDigits(v) || HAS_MONTH_IN_DATE.test(v);

const NO_TEXT = new Set(["SCRIPT", "STYLE", "TEXTAREA", "NOSCRIPT"]);
const NO_DIGITS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "NOSCRIPT"]);
const ATTRS = ["placeholder", "title", "aria-label", "alt"] as const;

function inside(node: Node | null, tags: Set<string>, attr: string): boolean {
  for (let el = node instanceof Element ? node : node?.parentElement ?? null; el; el = el.parentElement) {
    if (tags.has(el.tagName) || el.hasAttribute(attr) || el.hasAttribute("data-keep-lang") || (el as HTMLElement).isContentEditable) return true;
  }
  return false;
}

export function EnglishScreen({ on }: { on: boolean }) {
  const dict = useDict();
  useEffect(() => {
    if (!on) {
      document.documentElement.removeAttribute("data-lang-pending");
      return;
    }
    const tr = screenTranslator(dict);
    const written = new WeakMap<Node, string>(); // what this wrote last — not looked at again

    const english = (v: string, node: Node, digits: boolean) => {
      let out = tr(v) ?? v;
      if (digits && needs(out) && !inside(node, NO_DIGITS, "data-keep-digits")) out = toEnglish(out);
      return out;
    };

    const text = (node: Text) => {
      const v = node.nodeValue;
      if (!v || written.get(node) === v || inside(node, NO_TEXT, "data-keep-lang")) return;
      const out = english(v, node, true);
      if (out !== v) {
        node.nodeValue = out;
        written.set(node, out);
      }
    };

    const attrs = (el: Element) => {
      if (inside(el, NO_TEXT, "data-keep-lang")) return;
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (v) {
          const out = english(v, el.parentElement ?? el, true);
          if (out !== v) el.setAttribute(a, out);
        }
      }
      if (el instanceof HTMLInputElement && (el.type === "submit" || el.type === "button" || el.type === "reset") && el.value) {
        const out = tr(el.value);
        if (out) el.value = out;
      }
    };

    const tree = (root: Node) => {
      if (root.nodeType === Node.TEXT_NODE) return text(root as Text);
      if (!(root instanceof Element)) return;
      attrs(root);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) text(n as Text);
      for (const el of root.querySelectorAll("[placeholder],[title],[aria-label],[alt],input[type=submit],input[type=button],input[type=reset]")) attrs(el);
    };

    const title = () => {
      const out = translateTitle(tr, document.title);
      if (out) document.title = toEnglish(out);
    };

    tree(document.body);
    title();
    document.documentElement.removeAttribute("data-lang-pending");

    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "characterData") text(r.target as Text);
        else if (r.type === "attributes") attrs(r.target as Element);
        else r.addedNodes.forEach(tree);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
    const head = new MutationObserver(title);
    head.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      head.disconnect();
    };
  }, [on, dict]);
  return null;
}
