import { useEffect, useState } from "preact/hooks";

import { api } from "./api";
import { TabBar } from "./components/tab-bar";
import { usePath } from "./router";
import { Import } from "./routes/import";
import { Login } from "./routes/login";
import { Placeholder } from "./routes/placeholder";
import { Recipes } from "./routes/recipes";

/** Which screen a pathname maps to. Everything but Login is scaffolding. */
function Screen({ path }: { path: string }) {
  if (path.startsWith("/plan")) {
    return (
      <Placeholder
        title="Plan"
        note="Week view, Monday to Sunday. Step 2e.4."
      />
    );
  }
  if (path.startsWith("/list")) {
    return (
      <Placeholder
        title="Shopping list"
        note="Shared, checkable, polls every five seconds. Step 2e.3."
      />
    );
  }
  if (path.startsWith("/recipes/")) {
    return (
      <Placeholder
        title="Recipe"
        note="The note, its ingredients, and send-to-list. Step 2e.3."
      />
    );
  }
  if (path.startsWith("/recipes")) {
    return <Recipes />;
  }
  if (path.startsWith("/import")) {
    return <Import />;
  }
  return (
    <Placeholder
      title="Tonight"
      note="Today's dinner, the week strip, and the unchecked count. Step 2e.5."
    />
  );
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

  // Don't flash the login screen while the session check is in flight.
  if (signedIn === null) return null;
  if (!signedIn) return <Login onSignedIn={() => setSignedIn(true)} />;

  return (
    <div class="flex h-full flex-col">
      <main class="flex-1 overflow-y-auto">
        <Screen path={path} />
      </main>
      <TabBar path={path} />
    </div>
  );
}
