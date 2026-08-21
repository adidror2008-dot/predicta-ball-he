/* PredictaBall service worker — push notifications only. */

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { title: "PredictaBall", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "PredictaBall";
  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/favicon-32.png",
    dir: "rtl",
    lang: "he",
    tag: payload.tag || undefined,
    renotify: Boolean(payload.tag),
    data: { url: payload.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin);

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (new URL(client.url).origin === target.origin && "focus" in client) {
          if ("navigate" in client) {
            return client.navigate(target.href).then((c) => (c ? c.focus() : undefined));
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
