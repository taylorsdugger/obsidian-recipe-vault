import * as Tesseract from "tesseract.js";

/** Fields extracted from OCR text by the heuristic parser. */
export interface ParsedRecipe {
  name: string;
  recipeIngredient: string[];
  recipeInstructions: string[];
  totalTime: string;
  author: string;
}

export interface ParseRecipeOptions {
  strictCleanup?: boolean;
}

export interface OcrScanMetadata {
  confidence: number;
  orientationDegrees: number;
  cropApplied: boolean;
  preprocessedImageDataUrl: string;
}

export interface OcrRecognitionResult {
  text: string;
  metadata: OcrScanMetadata;
}

const OCR_MIN_CONFIDENCE = 70;
const OCR_CONTRAST_FACTOR = 1.45;
const OCR_CROP_LUMA_THRESHOLD = 245;
const OCR_CROP_PADDING = 12;

function clampChannel(value: number): number {
  if (value < 0) return 0;
  if (value > 255) return 255;
  return value;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function getCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to create canvas context for OCR preprocessing.");
  }
  return ctx;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image for OCR."));
    img.src = src;
  });
}

function rotateCanvas(
  source: HTMLCanvasElement,
  degrees: number,
): HTMLCanvasElement {
  const normalized = (((Math.round(degrees / 90) * 90) % 360) + 360) % 360;
  if (normalized === 0) return source;

  const swapAxes = normalized === 90 || normalized === 270;
  const output = createCanvas(
    swapAxes ? source.height : source.width,
    swapAxes ? source.width : source.height,
  );
  const ctx = getCanvasContext(output);

  ctx.translate(output.width / 2, output.height / 2);
  ctx.rotate((normalized * Math.PI) / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);

  return output;
}

function applyContrast(source: HTMLCanvasElement, factor: number): void {
  const ctx = getCanvasContext(source);
  const imageData = ctx.getImageData(0, 0, source.width, source.height);
  const { data } = imageData;

  for (let i = 0; i < data.length; i += 4) {
    data[i] = clampChannel((data[i] - 128) * factor + 128);
    data[i + 1] = clampChannel((data[i + 1] - 128) * factor + 128);
    data[i + 2] = clampChannel((data[i + 2] - 128) * factor + 128);
  }

  ctx.putImageData(imageData, 0, 0);
}

function cropMargins(
  source: HTMLCanvasElement,
  threshold: number,
  padding: number,
): { canvas: HTMLCanvasElement; cropped: boolean } {
  const ctx = getCanvasContext(source);
  const imageData = ctx.getImageData(0, 0, source.width, source.height);
  const { data } = imageData;
  const width = source.width;
  const height = source.height;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      // Treat darker or colored pixels as likely text/content.
      if (a > 8 && luma < threshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  // If no content area is detected, keep original image.
  if (maxX < minX || maxY < minY) {
    return { canvas: source, cropped: false };
  }

  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(width - 1, maxX + padding);
  maxY = Math.min(height - 1, maxY + padding);

  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;

  // Ignore tiny crops that are usually false detections.
  if (cropWidth < width * 0.2 || cropHeight < height * 0.2) {
    return { canvas: source, cropped: false };
  }

  const output = createCanvas(cropWidth, cropHeight);
  const outCtx = getCanvasContext(output);
  outCtx.drawImage(
    source,
    minX,
    minY,
    cropWidth,
    cropHeight,
    0,
    0,
    cropWidth,
    cropHeight,
  );
  return { canvas: output, cropped: true };
}

async function preprocessImageForOcr(image: string): Promise<{
  imageDataUrl: string;
  orientationDegrees: number;
  cropApplied: boolean;
}> {
  let orientationDegrees = 0;

  try {
    const detectResult = await Tesseract.detect(image);
    const detected = detectResult?.data?.orientation_degrees;
    if (typeof detected === "number") {
      orientationDegrees = detected;
    }
  } catch {
    // If orientation detection fails, continue with original orientation.
  }

  const img = await loadImageElement(image);
  const baseCanvas = createCanvas(
    img.naturalWidth || img.width,
    img.naturalHeight || img.height,
  );
  const baseCtx = getCanvasContext(baseCanvas);
  baseCtx.drawImage(img, 0, 0);

  const oriented = rotateCanvas(baseCanvas, orientationDegrees);
  applyContrast(oriented, OCR_CONTRAST_FACTOR);
  const cropped = cropMargins(
    oriented,
    OCR_CROP_LUMA_THRESHOLD,
    OCR_CROP_PADDING,
  );

  return {
    imageDataUrl: cropped.canvas.toDataURL("image/png"),
    orientationDegrees,
    cropApplied: cropped.cropped,
  };
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
  const result = await recognizeTextWithMetadata(image, onProgress);
  return result.text;
}

export async function recognizeTextWithMetadata(
  image: string,
  onProgress?: (progress: number) => void,
): Promise<OcrRecognitionResult> {
  const preprocessed = await preprocessImageForOcr(image);

  const worker = await Tesseract.createWorker("eng", Tesseract.OEM.DEFAULT, {
    logger: (info: Tesseract.LoggerMessage) => {
      if (info.status === "recognizing text" && onProgress) {
        onProgress(info.progress);
      }
    },
  });

  let result: Tesseract.RecognizeResult;
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
    });
    result = await worker.recognize(preprocessed.imageDataUrl, {
      rotateAuto: true,
    });
  } finally {
    await worker.terminate();
  }

  const confidence = result.data.confidence ?? 0;
  if (confidence < OCR_MIN_CONFIDENCE) {
    throw new Error(
      `OCR confidence ${Math.round(confidence)}% is below ${OCR_MIN_CONFIDENCE}%. Please retake the photo with better lighting and framing.`,
    );
  }

  return {
    text: result.data.text,
    metadata: {
      confidence,
      orientationDegrees: preprocessed.orientationDegrees,
      cropApplied: preprocessed.cropApplied,
      preprocessedImageDataUrl: preprocessed.imageDataUrl,
    },
  };
}

/* ----------------------------- Heuristic parser ----------------------------- */

const INGREDIENT_RE =
  /^[\s-–•*]*(\d[\d./½¼¾⅓⅔⅛⅜⅝⅞ ]*)\s*(tsp|tbsp|tablespoons?|teaspoons?|cups?|oz|ounces?|lbs?|pounds?|g|grams?|kg|ml|l|liters?|litres?|cloves?|cans?|pinch|bunch|handful|stalks?|slices?|pieces?|sprigs?|heads?|packages?|pkg)?\s+.+/i;

const STEP_RE = /^\s*(\d+)[.)]\s+/;

const TIME_RE = /(?:total\s*time|cook\s*time|prep\s*time|time)\s*[:=]\s*(.+)/i;

const AUTHOR_RE = /(?:from|by|source|author|adapted from)\s*[:=]\s*(.+)/i;

const SECTION_HEADER_RE =
  /^#{0,4}\s*(ingredients|directions|instructions|method|steps|preparation)/i;

function countMatches(input: string, re: RegExp): number {
  return (input.match(re) || []).length;
}

function normalizeOcrLine(line: string): string {
  return line
    .replace(/[|]+/g, " ")
    .replace(/[~`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isMostlyNoise(line: string): boolean {
  const s = line.trim();
  if (!s) return true;

  const letters = countMatches(s, /[A-Za-z]/g);
  const digits = countMatches(s, /\d/g);
  const symbols = countMatches(s, /[^A-Za-z0-9\s'&/.,%()-]/g);
  const words = s.split(/\s+/).filter(Boolean);
  const singleCharWords = words.filter((w) => /^[A-Za-z]$/.test(w)).length;

  if (letters === 0 && digits === 0) return true;
  if (symbols > Math.max(3, Math.floor(s.length * 0.3))) return true;
  if (words.length >= 4 && singleCharWords >= 3) return true;

  return false;
}

function isLikelyIngredientLine(
  line: string,
  inIngredientsSection = false,
): boolean {
  const s = line.trim();
  if (!s || isMostlyNoise(s)) return false;
  if (SECTION_HEADER_RE.test(s)) return false;
  if (TIME_RE.test(s) || AUTHOR_RE.test(s)) return false;
  if (STEP_RE.test(s)) return false;

  // Strong signal: quantity-based ingredient line.
  if (INGREDIENT_RE.test(s)) return true;

  const letters = countMatches(s, /[A-Za-z]/g);
  const words = s.split(/\s+/).filter(Boolean);

  // In an explicit Ingredients section, allow short single-word items like
  // "salt" or "pepper" that OCR frequently extracts without quantities.
  if (inIngredientsSection) {
    return letters >= 3 && words.length >= 1;
  }

  // Allow ingredient lines without explicit quantity (e.g., "salt to taste").
  return letters >= 4 && words.length >= 2;
}

function isLikelyInstructionLine(line: string): boolean {
  const s = line.trim();
  if (!s || isMostlyNoise(s)) return false;
  if (SECTION_HEADER_RE.test(s)) return false;
  if (TIME_RE.test(s) || AUTHOR_RE.test(s)) return false;

  // Numbered step is always accepted.
  if (STEP_RE.test(s)) return true;

  const letters = countMatches(s, /[A-Za-z]/g);
  const words = s.split(/\s+/).filter(Boolean);
  return letters >= 6 && words.length >= 3;
}

/**
 * Best-effort check for whether a line looks like a recipe title instead of OCR noise.
 */
function isLikelyTitle(line: string): boolean {
  const candidate = line.trim();
  if (!candidate) return false;
  if (candidate.length < 4 || candidate.length > 80) return false;
  if (/https?:\/\/|www\./i.test(candidate)) return false;
  if (SECTION_HEADER_RE.test(candidate)) return false;
  if (INGREDIENT_RE.test(candidate) || STEP_RE.test(candidate)) return false;
  if (TIME_RE.test(candidate) || AUTHOR_RE.test(candidate)) return false;

  const letters = countMatches(candidate, /[A-Za-z]/g);
  const symbols = countMatches(candidate, /[^A-Za-z0-9\s'&/-]/g);
  const words = candidate.split(/\s+/).filter(Boolean);
  const singleCharWords = words.filter((w) => /^[A-Za-z]$/.test(w)).length;

  if (letters < 4) return false;
  if (symbols > Math.max(2, Math.floor(candidate.length * 0.2))) return false;
  if (singleCharWords >= 3) return false;

  return true;
}

/**
 * Prefer the nearest plausible title above an Ingredients header if present.
 */
function findTitleNearIngredients(lines: string[]): string {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^#{0,4}\s*ingredients\b/i.test(line)) continue;

    for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
      const prev = lines[j]?.trim();
      if (prev && isLikelyTitle(prev)) {
        return prev;
      }
    }
  }
  return "";
}

/**
 * Heuristically parse OCR text into recipe fields.
 * All parsing is best-effort — users will be able to edit every field before saving.
 */
export function parseRecipeText(
  text: string,
  options: ParseRecipeOptions = {},
): ParsedRecipe {
  const strictCleanup = options.strictCleanup ?? true;
  const lines = text.split("\n").map((l) => normalizeOcrLine(l));

  let name = findTitleNearIngredients(lines);
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

    // Name heuristic fallback: first plausible line.
    if (!name && isLikelyTitle(line)) {
      name = line;
      continue;
    }

    // Inside ingredient section
    if (section === "ingredients") {
      const ingredient = line.replace(/^[\s\-–•*]+/, "").trim();
      if (
        strictCleanup
          ? isLikelyIngredientLine(ingredient, true)
          : ingredient.length > 0 &&
            !SECTION_HEADER_RE.test(ingredient) &&
            !TIME_RE.test(ingredient) &&
            !AUTHOR_RE.test(ingredient)
      ) {
        ingredients.push(ingredient);
      }
      continue;
    }

    // Inside instructions section
    if (section === "instructions") {
      const stepMatch = line.match(STEP_RE);
      const step = stepMatch ? line.slice(stepMatch[0].length).trim() : line;
      if (
        strictCleanup
          ? isLikelyInstructionLine(step)
          : step.length > 0 &&
            !SECTION_HEADER_RE.test(step) &&
            !TIME_RE.test(step) &&
            !AUTHOR_RE.test(step)
      ) {
        instructions.push(step);
      }
      continue;
    }

    // Outside any section — use regex heuristics
    if (INGREDIENT_RE.test(line)) {
      const ingredient = line.replace(/^[\s\-–•*]+/, "").trim();
      if (strictCleanup ? isLikelyIngredientLine(ingredient) : !!ingredient) {
        ingredients.push(ingredient);
      }
      continue;
    }

    if (STEP_RE.test(line)) {
      const stepMatch = line.match(STEP_RE);
      const step = stepMatch ? line.slice(stepMatch[0].length).trim() : line;
      if (strictCleanup ? isLikelyInstructionLine(step) : !!step) {
        instructions.push(step);
      }
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
