"use client";

// POS slip: the printed page is exactly as tall as the slip (80 mm roll), measured before printing,
// so thermal printers do not feed a full A4 length. A4 copies keep the global @page (A4).
import { useEffect } from "react";

const PX_PER_MM = 96 / 25.4;

export function PosPageSize({ targetId }: { targetId: string }) {
  useEffect(() => {
    const style = document.createElement("style");
    style.dataset.pos = "page";
    const apply = () => {
      const el = document.getElementById(targetId);
      const mm = el ? Math.ceil(el.scrollHeight / PX_PER_MM) + 6 : 200;
      style.textContent = `@page { size: 80mm ${mm}mm; margin: 2mm 3mm; }`;
    };
    apply();
    document.head.appendChild(style);
    window.addEventListener("beforeprint", apply);
    return () => {
      window.removeEventListener("beforeprint", apply);
      style.remove();
    };
  }, [targetId]);
  return null;
}
