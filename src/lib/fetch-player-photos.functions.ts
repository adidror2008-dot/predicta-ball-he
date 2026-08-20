import { createServerFn } from "@tanstack/react-start";

export const fetchPlayerPhotos = createServerFn({ method: "POST" })
  .inputValidator((input: { limit?: number }) => input ?? {})
  .handler(async ({ data }) => {
    const { runFetchPlayerPhotos } = await import("@/lib/fetch-player-photos.server");
    return runFetchPlayerPhotos(data);
  });
