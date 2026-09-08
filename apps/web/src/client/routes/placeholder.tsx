/**
 * Every screen but Login is scaffolding until step 2e says otherwise. Keeping
 * them as one component means the shell, the tab bar, and routing can be
 * checked on a phone before there's any data to show.
 */
export function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <div class="space-y-2 p-6">
      <h1 class="text-xl font-semibold">{title}</h1>
      <p class="text-sm text-muted">{note}</p>
    </div>
  );
}
