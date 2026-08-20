import { runFetchMatchLineups } from "@/lib/fetch-match-lineups.server";
console.info(JSON.stringify(await runFetchMatchLineups({ matchExternalId: "16708137" })));
