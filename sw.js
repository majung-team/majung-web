// The push carries no content. The text is fixed here so no name or location passes through a push service.
self.addEventListener("push", (event) => {
  event.waitUntil(
    self.registration.showNotification("마중", {
      body: "차량이 약 3분 안에 도착해요. 나갈 준비를 해주세요.",
      tag: "majung-arrival",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => "focus" in client);
      return open ? open.focus() : self.clients.openWindow("/account");
    }),
  );
});
