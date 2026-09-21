import { render } from "preact";

import { App } from "./app";
import "./styles.css";

/**
 * Look for a new build whenever the app comes back to the foreground.
 *
 * The service worker is registered with `autoUpdate`, which reloads the page
 * as soon as a new one activates - but it only goes looking for a new one on a
 * page load. An installed PWA resumed from the app switcher never re-navigates,
 * so it can keep serving last week's bundle against this week's API for days.
 *
 * That is how a shopping list came back aisle-sorted by the server with no
 * aisle headers drawn on it: new worker, cached client.
 */
function updateOnResume(): void {
  if (!("serviceWorker" in navigator)) return;

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    void navigator.serviceWorker
      .getRegistration()
      .then((registration) => registration?.update())
      // Offline, or there's no worker yet. It'll try again next time.
      .catch(() => {});
  });
}

const root = document.getElementById("app");
if (!root) throw new Error("#app is missing from index.html");

render(<App />, root);
updateOnResume();
