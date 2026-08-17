import { createServerFn } from "@tanstack/react-start";

export const tick = createServerFn({ method: "POST" }).handler(async () => {
  const { runTick } = await import("@/lib/tick.server");
  return runTick();
});
