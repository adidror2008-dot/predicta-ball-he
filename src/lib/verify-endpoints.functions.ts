import { createServerFn } from "@tanstack/react-start";

export const verifyEndpoints = createServerFn({ method: "POST" }).handler(async () => {
  const { runVerifyEndpoints } = await import("@/lib/verify-endpoints.server");
  return runVerifyEndpoints();
});
