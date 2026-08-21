import { createServerFn } from "@tanstack/react-start";

export const getNewsListFn = createServerFn({ method: "POST" }).handler(async () => {
  const { getNewsList } = await import("@/lib/news-read.server");
  return getNewsList();
});
