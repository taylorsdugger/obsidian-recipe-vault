import { useEffect, useState } from "preact/hooks";

import { api } from "./api";
import { TabBar } from "./components/tab-bar";
import { usePath } from "./router";
import { startAutoSync } from "./sync";
import { Home } from "./routes/home";
import { Import } from "./routes/import";
import { List } from "./routes/list";
import { Login } from "./routes/login";
import { Plan } from "./routes/plan";
import { Recipe } from "./routes/recipe";
import { Recipes } from "./routes/recipes";
import { Settings } from "./routes/settings";
import { Shared } from "./routes/shared";

/** Which screen a pathname maps to. Anything unmatched falls through to Home. */
function Screen({ path }: { path: string }) {
  if (path.startsWith("/plan")) {
    return <Plan />;
  }
  if (path.startsWith("/list")) {
    return <List />;
  }
  if (path.startsWith("/recipes/")) {
    // `/recipes/<id>/cook` is the same screen with cook mode open over it, so
    // the recipe stays mounted underneath - its wake lock with it - and the
    // phone's back gesture closes cook mode rather than leaving the recipe.
    const [id, mode] = path.slice("/recipes/".length).split("/");
    return <Recipe id={id} cooking={mode === "cook"} />;
  }
  if (path.startsWith("/recipes")) {
    return <Recipes />;
  }
  if (path.startsWith("/import")) {
    return <Import />;
  }
  if (path.startsWith("/settings")) {
    return <Settings />;
  }
  return <Home />;
}

export function App() {
  const path = usePath();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .session()
      .then((s) => setSignedIn(s.signedIn))
      .catch(() => setSignedIn(false));
  }, []);

  // Pull the vault in on open and whenever the app comes back to the front.
  // Nothing pushes from R2, so this is what keeps the two sides together.
  useEffect(() => {
    if (!signedIn) return;
    return startAutoSync();
  }, [signedIn]);

  // A shared recipe is for someone without the password, so it skips the
  // session check and the app's chrome entirely.
  if (path.startsWith("/s/")) {
    const [token, mode] = path.slice("/s/".length).split("/");
    return (
      <main>
        <Shared token={token} cooking={mode === "cook"} />
      </main>
    );
  }

  // Don't flash the login screen while the session check is in flight.
  if (signedIn === null) return null;
  if (!signedIn) return <Login onSignedIn={() => setSignedIn(true)} />;

  // Tab bar fixed over the bottom of the page on a phone; from `md` up it
  // sits to the left. `order-first` keeps the DOM order the same either way,
  // so the screen's content is still what a screen reader lands on first.
  //
  // A recipe is a pushed screen: on a phone it has a back arrow instead of
  // the tabs, and the space goes to its own dock. Everything else leaves room
  // at the bottom for the tab bar to sit over.
  const pushed = path.startsWith("/recipes/");
  return (
    <div class="md:flex">
      <main
        class={`min-w-0 md:flex-1 md:pb-0 ${pushed ? "" : "pb-[calc(3.75rem+1px+env(safe-area-inset-bottom))]"}`}
      >
        <Screen path={path} />
      </main>
      <TabBar path={path} pushed={pushed} />
    </div>
  );
}
