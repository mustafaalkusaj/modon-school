var VIBRATE_URGENT = [300, 100, 300, 100, 300, 100, 300];
var VIBRATE_IMPORTANT = [250, 80, 250, 80, 250];
var VIBRATE_NORMAL = [150, 50, 150];

var CATEGORY_ROUTES = {
  exams: "/ar/student",
  homework: "/ar/student",
  financial: "/ar/payments",
  activity: "/ar/student",
  holiday: "/ar/student",
  general: "/ar",
};

var CATEGORY_ICON = {
  general: "🔔",
  exams: "📝",
  homework: "📚",
  holiday: "🎉",
  financial: "💳",
  activity: "⚽",
};

self.addEventListener("push", function (event) {
  var data = event.data ? event.data.json() : {};
  var priority = data.priority || "normal";
  var category = data.category || "general";
  var emoji = CATEGORY_ICON[category] || "🔔";
  var title = emoji + " " + (data.title || "إشعار جديد");

  var isUrgent = priority === "urgent";
  var isImportant = priority === "important";

  var vibrate = isUrgent
    ? VIBRATE_URGENT
    : isImportant
      ? VIBRATE_IMPORTANT
      : VIBRATE_NORMAL;

  var options = {
    body: data.body || "",
    icon: "/icon.png",
    badge: "/icon.png",
    data: data,
    vibrate: vibrate,
    tag: data.notificationId || "notif-" + Date.now(),
    renotify: true,
    requireInteraction: isUrgent || isImportant,
    silent: false,
  };

  if (isUrgent) {
    options.actions = [
      { action: "open", title: "فتح" },
      { action: "dismiss", title: "تجاهل" },
    ];
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  if (event.action === "dismiss") return;

  var data = event.notification.data || {};
  var category = data.category || "general";
  var urlToOpen = data.url || CATEGORY_ROUTES[category] || "/ar";

  if (urlToOpen.indexOf("http") !== 0) {
    urlToOpen = self.location.origin + urlToOpen;
  }

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (clientList) {
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          if (client.url.indexOf(self.location.origin) !== -1 && "focus" in client) {
            client.navigate(urlToOpen);
            return client.focus();
          }
        }
        return clients.openWindow(urlToOpen);
      }),
  );
});
