/**
 * The handful of line glyphs the screens share. 24-unit paths, stroked in
 * the current text colour, so an icon takes whatever colour its button is.
 */
const PATHS = {
  close: "M6 6l12 12M18 6 6 18",
  "chevron-left": "m15 18-6-6 6-6",
  "chevron-right": "m9 18 6-6-6-6",
  "arrow-up": "M12 19V5M5 12l7-7 7 7",
  "chevron-down": "m6 9 6 6 6-6",
  list: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  clock: "M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 7v5l3 2",
  sun: "M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  cart: "M2 3h3l2.5 12h12L22 7H6.2M9 20h.01M18 20h.01",
  flame:
    "M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 .3 1.6 1 2.5 2 3 0-3 .5-5.5.5-8z",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  search: "M4 11a7 7 0 1 0 14 0a7 7 0 1 0-14 0M20 20l-3.5-3.5",
  made: "M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M8 12l3 3 5-6",
  check: "m6 12.5 4 4 8-9",
  share: "M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  "link-off":
    "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1M4 4l16 16",
  copy: "M9 9h10v10H9zM5 15V5h10",
  pdf: "M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 13h6M9 17h6",
  external: "M7 17 17 7M8 7h9v9",
  edit: "M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  settings:
    "M4 6h10M18 6h2M4 12h2M10 12h10M4 18h10M18 18h2M14 4v4M6 10v4M14 16v4",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  class: cls = "size-5",
  stroke = 1.8,
}: {
  name: IconName;
  class?: string;
  stroke?: number;
}) {
  return (
    <svg viewBox="0 0 24 24" class={`shrink-0 ${cls}`} aria-hidden="true">
      <path
        d={PATHS[name]}
        fill="none"
        stroke="currentColor"
        stroke-width={stroke}
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}
