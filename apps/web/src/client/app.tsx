import { useEffect, useRef, useState } from "preact/hooks";

import { api } from "./api";
import { TabBar } from "./components/tab-bar";
import { usePath } from "./router";
import { setScrollContainer } from "./scroll";
import { startAutoSync } from "./sync";
import { Import } from "./routes/import";
import { List } from "./routes/list";
import { Login } from "./routes/login";
import { Placeholder } from "./routes/placeholder";
import { Plan } from "./routes/plan";
import { Recipe } from "./routes/recipe";
import { Recipes } from "./routes/recipes";

/** Which screen a pathname maps to. Home is the last one still scaffolding. */
function Screen({ path }: { path: string }) {
  if (path.startsWith("/plan")) {
    return <Plan />;
  }
  if (path.startsWith("/list")) {
    return <List />;
  }
  if (path.startsWith("/recipes/")) {
    return <Recipe id={path.slice("/recipes/".length)} />;
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
  const scroller = useRef<HTMLElement | null>(null);

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

  // Don't flash the login screen while the session check is in flight.
  if (signedIn === null) return null;
  if (!signedIn) return <Login onSignedIn={() => setSignedIn(true)} />;

  return (
    <div class="flex h-full flex-col">
      <main
        class="flex-1 overflow-y-auto"
        ref={(el) => {
          scroller.current = el;
          setScrollContainer(el);
        }}
      >
        <Screen path={path} />
      </main>
      <TabBar path={path} />
    </div>
  );
}
