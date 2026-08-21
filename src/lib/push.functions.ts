import { createServerFn } from "@tanstack/react-start";

export const getVapidPublicKey = createServerFn({ method: "GET" }).handler(async () => {
  const publicKey = process.env["VAPID_PUBLIC_KEY"] ?? null;
  return { publicKey };
});
