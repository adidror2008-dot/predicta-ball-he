import { runFetchPlayerPhotos } from "@/lib/fetch-player-photos.server";
console.info(JSON.stringify(await runFetchPlayerPhotos({ limit: 20 })));
