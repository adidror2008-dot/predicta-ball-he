import webpush from "web-push";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type PushSubscriptionRow = {
  id: string;
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
};

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

export type SendPushResult = {
  ok: boolean;
  status: number | null;
  removed: boolean;
  error?: string;
};

/**
 * Sends one Web Push message.
 * Uses web-push only to build the encrypted request (VAPID + aes128gcm),
 * then dispatches with fetch — the Worker runtime has no node https client.
 * A 404/410 from the push service means the subscription is dead → delete the row.
 */
export async function sendPush(
  subscription: PushSubscriptionRow,
  payload: PushPayload,
): Promise<SendPushResult> {
  const publicKey = process.env["VAPID_PUBLIC_KEY"];
  const privateKey = process.env["VAPID_PRIVATE_KEY"];
  const subject = process.env["VAPID_SUBJECT"];

  if (!publicKey || !privateKey || !subject) {
    return { ok: false, status: null, removed: false, error: "missing VAPID env" };
  }
  if (!subscription.endpoint || !subscription.p256dh || !subscription.auth) {
    await supabaseAdmin.from("push_subscriptions").delete().eq("id", subscription.id);
    return { ok: false, status: null, removed: true, error: "incomplete subscription" };
  }

  let details: ReturnType<typeof webpush.generateRequestDetails>;
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    details = webpush.generateRequestDetails(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
      { TTL: 600 },
    );
  } catch (e) {
    return {
      ok: false,
      status: null,
      removed: false,
      error: e instanceof Error ? e.message : "encrypt failed",
    };
  }

  // One outgoing call per attempt. No retry.
  let status: number | null = null;
  try {
    const res = await fetch(details.endpoint, {
      method: "POST",
      headers: details.headers as Record<string, string>,
      body: details.body as unknown as BodyInit,
    });
    status = res.status;
  } catch (e) {
    return {
      ok: false,
      status: null,
      removed: false,
      error: e instanceof Error ? e.message : "fetch failed",
    };
  }

  if (status === 404 || status === 410) {
    await supabaseAdmin.from("push_subscriptions").delete().eq("id", subscription.id);
    return { ok: false, status, removed: true, error: "subscription gone" };
  }

  return { ok: status >= 200 && status < 300, status, removed: false };
}

export function getVapidPublicKeyValue(): string | null {
  return process.env["VAPID_PUBLIC_KEY"] ?? null;
}
