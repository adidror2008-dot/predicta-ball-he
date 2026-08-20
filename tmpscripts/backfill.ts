import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runFetchMatchLineups } from "@/lib/fetch-match-lineups.server";
const { data } = await supabaseAdmin.rpc("exec_noop" as never).then(()=>({data:null})).catch(()=>({data:null}));
const ids = ["16771910","16421050","16707695","16707702","16707704","16421055","16707694","16707697","16707698","16707699","16708136","16708138","16708148","16708139","16708140","16708141","16708144","16708135","16708142","16708145","16416292","16708146"];
let ok=0;
for (const id of ids) {
  const r = await runFetchMatchLineups({ matchExternalId: id });
  ok += r.status === "success" ? 1 : 0;
  console.info(id, r.status, r.lineups_upserted, r.ratings_upserted, r.message ?? "");
  if (r.budget_exhausted) break;
}
console.info("backfilled_ok", ok);
