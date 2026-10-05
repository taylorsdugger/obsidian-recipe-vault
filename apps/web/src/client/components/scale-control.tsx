// Deep import on purpose, like the recipe screen's: the core barrel pulls in
// cheerio and handlebars, which the phone does not need.
import {
  scaleLabel,
  servingsOf,
  stepScale,
  yieldLabel,
} from "@recipe-vault/core/scale";

import { Icon } from "./icon";

/**
 * Minus, what the recipe makes now, plus. With servings in the recipe it
 * moves a serving at a time and says "Serves 6"; without, it goes through
 * ½×, 1×, 1½×, 2× and so on. Tapping the middle puts it back to as written.
 */
export function ScaleControl({
  factor,
  servings,
  onChange,
  class: cls = "",
}: {
  factor: number;
  /** The recipe's yield as written, or "" when it doesn't say. */
  servings: string;
  onChange: (factor: number) => void;
  class?: string;
}) {
  const base = servingsOf(servings);
  const label = yieldLabel(servings, factor) || scaleLabel(factor);
  const scaled = factor !== 1;
  const down = stepScale(factor, -1, base);
  const up = stepScale(factor, 1, base);

  return (
    <div
      class={`inline-flex h-10 items-center rounded-full border border-line bg-surface ${cls}`}
      role="group"
      aria-label="Scale recipe"
    >
      <button
        type="button"
        class="grid size-10 place-items-center rounded-full disabled:opacity-40"
        aria-label="Scale down"
        disabled={down === factor}
        onClick={() => onChange(down)}
      >
        <Icon name="minus" class="size-4" stroke={2} />
      </button>
      <button
        type="button"
        class={`min-w-16 px-1 text-sm font-semibold tabular-nums ${
          scaled ? "text-accent-ink" : ""
        }`}
        aria-label={scaled ? `${label}. Reset to as written` : label}
        title={scaled ? "Back to as written" : undefined}
        disabled={!scaled}
        onClick={() => onChange(1)}
      >
        {label}
        {scaled && base !== null && (
          <span class="ml-1 font-medium text-muted">{scaleLabel(factor)}</span>
        )}
      </button>
      <button
        type="button"
        class="grid size-10 place-items-center rounded-full disabled:opacity-40"
        aria-label="Scale up"
        disabled={up === factor}
        onClick={() => onChange(up)}
      >
        <Icon name="plus" class="size-4" stroke={2} />
      </button>
    </div>
  );
}
