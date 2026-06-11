// ===== SURUHBELI PWA SERVICE WORKER (PWA VALID, NO PAGE CACHE) ===== //

const APP_VERSION = "2";

// Install (wajib untuk PWA)
self.addEventListener("install", (event) => {
  console.log("SW Installed v" + APP_VERSION);
  self.skipWaiting();
});

// Activate (ambil kontrol semua tab)
self.addEventListener("activate", (event) => {
  console.log("SW Activated");
  event.waitUntil(self.clients.claim());
});

// Fetch handler (NETWORK FIRST, TANPA CACHE HALAMAN)
self.addEventListener("fetch", (event) => {
  // Hanya handle request GET
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request).catch(() => {
      // Optional fallback kalau offline
      return new Response("Offline", {
        status: 503,
        statusText: "Offline Mode"
      });
    })
  );
});