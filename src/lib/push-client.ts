import { toast } from "sonner";
import { getVapidPublicKey } from "@/lib/push.functions";
import { supabase } from "@/integrations/supabase/client";

const BLOCKED_MESSAGE = "ההתראות חסומות בדפדפן — יש לאפשר אותן בהגדרות הדפדפן";

export type EnsurePushResult =
  | { ok: true; endpoint: string }
  | { ok: false; reason: "unsupported" | "denied" | "no-key" | "error"; message?: string };

function supported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Registers the single push service worker. Safe to call more than once. */
export async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration("/");
    if (existing) return existing;
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * Makes sure the current browser has a live push subscription stored for the
 * signed-in user. Idempotent: an existing subscription is never duplicated.
 */
export async function ensurePushSubscription(): Promise<EnsurePushResult> {
  if (!supported()) {
    toast.error("הדפדפן הזה לא תומך בהתראות");
    return { ok: false, reason: "unsupported" };
  }

  if (Notification.permission === "denied") {
    toast.error(BLOCKED_MESSAGE);
    return { ok: false, reason: "denied" };
  }

  if (Notification.permission === "default") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      toast.error(BLOCKED_MESSAGE);
      return { ok: false, reason: "denied" };
    }
  }

  try {
    const registration = (await registerPushServiceWorker()) ?? (await navigator.serviceWorker.ready);
    if (!registration) return { ok: false, reason: "error", message: "no service worker" };
    await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const { publicKey } = await getVapidPublicKey();
      if (!publicKey) {
        toast.error("שירות ההתראות אינו זמין כרגע");
        return { ok: false, reason: "no-key" };
      }
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
      });
    }

    const json = subscription.toJSON();
    const endpoint = json.endpoint ?? subscription.endpoint;
    const p256dh = json.keys?.["p256dh"] ?? null;
    const auth = json.keys?.["auth"] ?? null;

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return { ok: false, reason: "error", message: "no session" };

    const { data: existing } = await supabase
      .from("push_subscriptions")
      .select("id")
      .eq("user_id", userId)
      .eq("endpoint", endpoint)
      .maybeSingle();

    if (!existing) {
      await supabase.from("push_subscriptions").insert({
        user_id: userId,
        endpoint,
        p256dh,
        auth,
        user_agent: navigator.userAgent,
      });
    }

    return { ok: true, endpoint };
  } catch (e) {
    toast.error("לא הצלחנו להפעיל התראות בדפדפן");
    return { ok: false, reason: "error", message: e instanceof Error ? e.message : "unknown" };
  }
}
