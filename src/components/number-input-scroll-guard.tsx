"use client";

import { useEffect } from "react";

/**
 * Global guard component that prevents mouse wheel / scroll events from changing
 * values on <input type="number"> fields across the entire application.
 *
 * It intercepts wheel events on number inputs, blocks browser increment/decrement
 * (preventDefault), and blurs the input if focused so the page scrolls smoothly.
 */
export function NumberInputScrollGuard() {
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      const target = e.target;
      const activeEl = document.activeElement;

      const isTargetNumberInput = target instanceof HTMLInputElement && target.type === "number";
      const isActiveNumberInput = activeEl instanceof HTMLInputElement && activeEl.type === "number";

      if (isTargetNumberInput || isActiveNumberInput) {
        // Prevent browser's default stepUp/stepDown number mutation
        e.preventDefault();

        // If the number input currently has focus, blur it so scrolling continues naturally
        if (target instanceof HTMLInputElement && target === activeEl) {
          target.blur();
        } else if (isActiveNumberInput && activeEl instanceof HTMLInputElement) {
          activeEl.blur();
        }
      }
    };

    // Use capture phase and non-passive listener so e.preventDefault() is honored
    document.addEventListener("wheel", handleWheel, { passive: false, capture: true });

    return () => {
      document.removeEventListener("wheel", handleWheel, { capture: true });
    };
  }, []);

  return null;
}
