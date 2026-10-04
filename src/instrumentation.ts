// Next.js calls register() once when a server instance starts. The NEXT_RUNTIME check is replaced
// at build time, so the Node-only scheduler (database, crypto) is never bundled for the Edge runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./server/scheduler");
    startScheduler();
  }
}
