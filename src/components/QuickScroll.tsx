import React, { useRef, useState } from "react";

interface QuickScrollProps {
  sections: string[];
  activeSection: string;
  onJump: (section: string) => void;
}

export function QuickScroll({
  sections,
  activeSection,
  onJump,
}: QuickScrollProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastDraggedSection = useRef<string>("");
  const [dragPreview, setDragPreview] = useState<{
    section: string;
    x: number;
    y: number;
  } | null>(null);

  if (sections.length === 0) return null;

  const formatSectionLabel = (section: string): string => {
    if (section.length === 1) return section;
    if (section === "Under 15 min") return "<15m";
    if (section === "15–30 min") return "15-30m";
    if (section === "30–60 min") return "30-60m";
    if (section === "1–2 hr") return "1-2h";
    if (section === "2+ hr") return "2h+";
    if (section === "Never made") return "Never";
    if (section === "1–3 times") return "1-3x";
    if (section === "4–10 times") return "4-10x";
    if (section === "11+ times") return "11+x";
    return section;
  };

  const updateDragSelection = (clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const previewX = Math.max(
      0,
      Math.min(clientX - containerRect.left, containerRect.width),
    );
    const previewY = Math.max(
      0,
      Math.min(clientY - containerRect.top, containerRect.height),
    );

    const horizontal = containerRect.width > containerRect.height;
    const primarySize = horizontal ? containerRect.width : containerRect.height;
    const primaryOffset = horizontal ? previewX : previewY;
    const ratio = primarySize <= 0 ? 0 : primaryOffset / primarySize;
    const index = Math.max(
      0,
      Math.min(sections.length - 1, Math.floor(ratio * sections.length)),
    );
    const section = sections[index];

    setDragPreview({
      section,
      x: previewX,
      y: previewY,
    });

    if (lastDraggedSection.current !== section) {
      lastDraggedSection.current = section;
      onJump(section);
    }
  };

  const endDrag = () => {
    lastDraggedSection.current = "";
    setDragPreview(null);
  };

  const isHorizontal = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return false;
    return rect.width > rect.height;
  };

  return (
    <div
      ref={containerRef}
      className={`recipe-gallery-quickscroll${dragPreview ? " dragging" : ""}`}
      aria-label="Jump to section"
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        updateDragSelection(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        updateDragSelection(event.clientX, event.clientY);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        endDrag();
      }}
      onPointerCancel={endDrag}
    >
      {dragPreview ? (
        <div
          className={`rg-qs-preview${isHorizontal() ? " horizontal" : ""}`}
          style={
            isHorizontal()
              ? { left: dragPreview.x, top: 0 }
              : { left: 0, top: dragPreview.y }
          }
        >
          {dragPreview.section}
        </div>
      ) : null}

      {sections.map((section) => (
        <button
          key={section}
          type="button"
          className={`rg-qs-item${activeSection === section ? " active" : ""}`}
          onClick={() => onJump(section)}
          title={section}
          aria-label={`Jump to ${section}`}
          aria-pressed={activeSection === section}
          data-section={section}
        >
          {formatSectionLabel(section)}
        </button>
      ))}
    </div>
  );
}
