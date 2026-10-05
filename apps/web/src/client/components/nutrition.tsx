// Deep import on purpose, like the recipe screen's: the core barrel pulls in
// cheerio and handlebars, which the phone does not need.
import {
  nutritionView,
  sourceHost,
  type Nutrition,
} from "@recipe-vault/core/nutrition";
import { useEffect, useRef, useState } from "preact/hooks";

import { Icon } from "./icon";

const DOT: Record<string, string> = {
  protein: "bg-protein",
  carbs: "bg-carbs",
  fat: "bg-fat",
};

const SHORT: Record<string, string> = { protein: "P", carbs: "C", fat: "F" };

function Dot({ macro }: { macro: string | null }) {
  return (
    <span
      aria-hidden="true"
      class={`size-2 shrink-0 rounded-full ${macro ? DOT[macro] : ""}`}
    />
  );
}

/**
 * Calories and the three macros on one line, under the title. The desktop's
 * says the words and opens a popover under itself; the phone's is the whole
 * width, uses letters, and opens a sheet.
 */
export function NutritionStrip({
  nutrition,
  servings,
  servingSize,
  compact,
  open,
  onClick,
}: {
  nutrition: Nutrition;
  /** The yield as written, so the strip can say what a serving is of. */
  servings: string;
  /** The page's own serving size: "1 of 12 fritters", or "". */
  servingSize: string;
  compact: boolean;
  open: boolean;
  onClick: () => void;
}) {
  const view = nutritionView(nutrition, servings, 1, false, servingSize);
  const macros = view.rows.filter((row) => row.isMacro);

  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      // Wraps between its pieces, never inside one, when the column's too
      // narrow for the whole line: a big number, or a long yield.
      class={`flex min-h-11 items-center rounded-[22px] border border-line bg-surface text-sm whitespace-nowrap text-ink hover:border-faint ${
        compact
          ? "w-full gap-2.5 pr-3 pl-3.5"
          : "flex-wrap gap-x-3 gap-y-1 self-start py-2 pr-3 pl-3.5 text-left"
      }`}
      onClick={onClick}
    >
      {view.calories && (
        <span>
          <b class={compact ? "" : "text-row"}>{view.calories}</b> cal
        </span>
      )}
      {macros.map((row) => (
        <span key={row.key} class="flex items-center gap-1.5">
          <Dot macro={row.key} />
          {compact ? (
            <>
              <b>{row.amount.replace(" ", "")}</b> {SHORT[row.key]}
            </>
          ) : (
            <>
              <b>{row.amount}</b> {row.label.toLowerCase()}
            </>
          )}
        </span>
      ))}
      {!view.calories && macros.length === 0 && <span>Nutrition</span>}
      {compact ? (
        <Icon
          name="chevron-right"
          class="ml-auto size-4 text-muted"
          stroke={2}
        />
      ) : (
        // One piece, so a wrap never leaves the chevron on a line alone.
        <span class="flex items-center gap-1.5 text-muted">
          {view.perLabel}
          <Icon
            name="chevron-down"
            class={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
            stroke={2}
          />
        </span>
      )}
    </button>
  );
}

/**
 * The details: the total, the calorie split as a bar, every nutrient with
 * its share, and where the numbers came from. Per serving or the whole
 * recipe at tonight's scale, when the recipe says how many it serves.
 */
export function NutritionDetails({
  nutrition,
  servings,
  servingSize,
  scale,
  sourceUrl,
  title,
}: {
  nutrition: Nutrition;
  /** The yield as written, or "" when the recipe doesn't say. */
  servings: string;
  /** The page's own serving size: "1 of 12 fritters", or "". */
  servingSize: string;
  scale: number;
  sourceUrl: string;
  /** The sheet has its own heading; the popover needs one. */
  title: boolean;
}) {
  const [whole, setWhole] = useState(false);
  const view = nutritionView(nutrition, servings, scale, whole, servingSize);
  const host = sourceHost(sourceUrl);
  const foot = [host ? `From ${host}` : "", view.split ? "% of calories" : ""]
    .filter(Boolean)
    .join(" · ");

  return (
    <div class="flex flex-col gap-3.5">
      {(title || view.canShowWhole) && (
        <div class="flex items-center justify-between gap-3">
          {title && (
            <span class="text-caption font-bold tracking-[0.08em] text-muted uppercase">
              Nutrition
            </span>
          )}
          {view.canShowWhole && (
            <div
              class={`grid grid-cols-2 gap-0.5 rounded-full bg-line p-[3px] ${title ? "" : "flex-1"}`}
              role="group"
              aria-label="Show nutrition for"
            >
              {(
                [
                  [false, "Per serving"],
                  [true, "Whole recipe"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={whole === value}
                  class={`rounded-full px-3 text-note ${title ? "h-7" : "h-9"} ${
                    whole === value
                      ? "bg-surface font-semibold text-ink"
                      : "text-muted"
                  }`}
                  onClick={() => setWhole(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {view.calories && (
        <div class="flex items-baseline gap-1.5">
          <span class="font-display text-[2.5rem] leading-none font-medium tabular-nums">
            {view.calories}
          </span>
          <span class="text-row text-muted">calories {view.caption}</span>
        </div>
      )}
      {view.servingNote && (
        <p class="-mt-2 text-sm text-muted">{view.servingNote}</p>
      )}

      {view.split && (
        <div role="img" aria-label={view.splitLabel} class="flex h-2 gap-0.5">
          {view.split
            .filter((macro) => macro.percent > 0)
            .map((macro) => (
              <span
                key={macro.key}
                class={`basis-0 rounded-full ${DOT[macro.key]}`}
                style={{ flexGrow: macro.percent }}
              />
            ))}
        </div>
      )}

      <div class="flex flex-col">
        {view.rows.map((row, i) => (
          <div
            key={row.key}
            class={`flex items-center gap-2.5 ${title ? "min-h-9" : "min-h-11"} ${
              i > 0 ? "border-t border-line" : ""
            }`}
          >
            <Dot macro={row.isMacro ? row.key : null} />
            <span class={`flex-1 ${title ? "text-sm" : "text-base"}`}>
              {row.label}
            </span>
            <span
              class={`font-semibold tabular-nums ${title ? "text-sm" : "text-base"}`}
            >
              {row.amount}
            </span>
            <span class="w-11 text-right text-note text-muted tabular-nums">
              {row.percent === null ? "" : `${row.percent}%`}
            </span>
          </div>
        ))}
      </div>

      {foot && <p class="text-xs text-muted">{foot}</p>}
    </div>
  );
}

/**
 * The desktop's strip with its details dropping down under it. Clicking
 * anywhere else or Escape closes it.
 */
export function NutritionPopover({
  nutrition,
  servings,
  servingSize,
  scale,
  sourceUrl,
}: {
  nutrition: Nutrition;
  servings: string;
  servingSize: string;
  scale: number;
  sourceUrl: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} class="relative flex self-start">
      <NutritionStrip
        nutrition={nutrition}
        servings={servings}
        servingSize={servingSize}
        compact={false}
        open={open}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <div
          role="dialog"
          aria-label="Nutrition"
          class="absolute top-full left-0 z-20 mt-2 w-[400px] rounded-[20px] border border-line bg-surface p-[18px] shadow-[0_18px_48px_oklch(0_0_0/0.18)]"
        >
          <NutritionDetails
            nutrition={nutrition}
            servings={servings}
            servingSize={servingSize}
            scale={scale}
            sourceUrl={sourceUrl}
            title
          />
        </div>
      )}
    </div>
  );
}
