import * as Tesseract from "tesseract.js";

/** Fields extracted from OCR text by the heuristic parser. */
export interface ParsedRecipe {
  name: string;
  recipeIngredient: string[];
  recipeInstructions: string[];
  totalTime: string;
  author: string;
}

/**
 * Run Tesseract.js OCR on an image and return the raw recognised text.
 * Accepts any value that Tesseract.js treats as an image source (URL string,
 * HTMLImageElement, HTMLCanvasElement, or HTMLVideoElement).
 */
export async function recognizeText(
  image: string,
  onProgress?: (progress: number) => void,
): Promise<string> {
  const result = await Tesseract.recognize(image, "eng", {
    logger: (info: Tesseract.LoggerMessage) => {
      if (info.status === "recognizing text" && onProgress) {
        onProgress(info.progress);
      }
    },
  });
  return result.data.text;
}

/* ----------------------------- Heuristic parser ----------------------------- */

const INGREDIENT_RE =
  /^[\s-–•*]*(\d[\d./½¼¾⅓⅔⅛⅜⅝⅞ ]*)\s*(tsp|tbsp|tablespoons?|teaspoons?|cups?|oz|ounces?|lbs?|pounds?|g|grams?|kg|ml|l|liters?|litres?|cloves?|cans?|pinch|bunch|handful|stalks?|slices?|pieces?|sprigs?|heads?|packages?|pkg)?\s+.+/i;

const STEP_RE = /^\s*(\d+)[.)]\s+/;

const TIME_RE = /(?:total\s*time|cook\s*time|prep\s*time|time)\s*[:=]\s*(.+)/i;

const AUTHOR_RE = /(?:from|by|source|author|adapted from)\s*[:=]\s*(.+)/i;

const SECTION_HEADER_RE =
  /^#{0,4}\s*(ingredients|directions|instructions|method|steps|preparation)/i;

/**
 * Heuristically parse OCR text into recipe fields.
 * All parsing is best-effort — users will be able to edit every field before saving.
 */
export function parseRecipeText(text: string): ParsedRecipe {
  const lines = text.split("\n").map((l) => l.trim());

  let name = "";
  const ingredients: string[] = [];
  const instructions: string[] = [];
  let totalTime = "";
  let author = "";

  type Section = "none" | "ingredients" | "instructions";
  let section: Section = "none";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // Detect section headers
    const headerMatch = line.match(SECTION_HEADER_RE);
    if (headerMatch) {
      const heading = headerMatch[1].toLowerCase();
      if (heading === "ingredients") {
        section = "ingredients";
      } else {
        section = "instructions";
      }
      continue;
    }

    // Try time
    const timeMatch = line.match(TIME_RE);
    if (timeMatch) {
      totalTime = totalTime || timeMatch[1].trim();
      continue;
    }

    // Try author
    const authorMatch = line.match(AUTHOR_RE);
    if (authorMatch) {
      author = author || authorMatch[1].trim();
      continue;
    }

    // Name heuristic: first non-empty line that is not an ingredient / step / header
    if (!name && !INGREDIENT_RE.test(line) && !STEP_RE.test(line)) {
      name = line;
      continue;
    }

    // Inside ingredient section
    if (section === "ingredients") {
      ingredients.push(line.replace(/^[\s\-–•*]+/, "").trim());
      continue;
    }

    // Inside instructions section
    if (section === "instructions") {
      const stepMatch = line.match(STEP_RE);
      instructions.push(
        stepMatch ? line.slice(stepMatch[0].length).trim() : line,
      );
      continue;
    }

    // Outside any section — use regex heuristics
    if (INGREDIENT_RE.test(line)) {
      ingredients.push(line.replace(/^[\s\-–•*]+/, "").trim());
      continue;
    }

    if (STEP_RE.test(line)) {
      const stepMatch = line.match(STEP_RE);
      instructions.push(
        stepMatch ? line.slice(stepMatch[0].length).trim() : line,
      );
      continue;
    }
  }

  return {
    name,
    recipeIngredient: ingredients,
    recipeInstructions: instructions,
    totalTime,
    author,
  };
}
