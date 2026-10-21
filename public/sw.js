// Web Push companion: paints the notification and routes its click back into the room.

self.addEventListener("push", (event) => {
	let data = {};
	try {
		data = event.data.json();
	} catch {
		// a payloadless push still must show something user-visible
	}
	const room = typeof data.room === "string" ? data.room : "";
	event.waitUntil(
		self.registration.showNotification(
			room ? `New message in #${room}` : "Comic Chat",
			{
				icon: "/pwa-192.png",
				// one live notification per room
				tag: `room-${room}`,
				data: { room },
			},
		),
	);
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const room = event.notification.data?.room;
	const url = room ? `/?room=${encodeURIComponent(room)}` : "/";
	event.waitUntil(
		clients
			.matchAll({ type: "window", includeUncontrolled: true })
			.then((windows) => {
				// focus only a window already on this room; anything else gets a fresh one
				const match = windows.find(
					(w) => new URL(w.url).searchParams.get("room") === room,
				);
				return match ? match.focus() : clients.openWindow(url);
			}),
	);
});
