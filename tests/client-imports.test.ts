// A "use client" component must not import server-only code (server-only, next/headers, @/server/*) — directly or through
// a shared module such as components/ui.tsx. Next.js fails the build with "You're importing a component that needs
// 'server-only'" when one does; this catches it in the test run. Client code translates with useT() from components/lang.
import { describe, expect, it } from "vitest";
import { clientViolations } from "../scripts/check-client-imports.mjs";

describe("client / server boundary", () => {
  it("no client component reaches server-only modules", () => {
    expect(clientViolations()).toEqual([]);
  });
});
