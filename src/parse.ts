/** A LaTeX location written in a Lean comment. Lines are 1-based and inclusive. */
export interface TexRef {
  rawPath: string;
  startLine: number;
  endLine: number;
}

/**
 * Marker, anywhere on the Lean line:
 *
 *     -- @tex: path/to/file.tex:120
 *     -- @tex: path/to/file.tex:120-135
 *     -- @tex: "path with spaces.tex":120
 *
 * The path is relative to the Lean file, relative to a workspace folder, or absolute.
 */
const MARKER = /@tex:\s*(?:"([^"]+)"|(\S+?)):(\d+)(?:-(\d+))?/;

/** A PDF rectangle written in a Lean comment. Origin is the top-left of the page, in big points. */
export interface PdfRef {
  rawPath: string;
  page: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 *     -- @pdf: demo.pdf:1:133.77:127.85:343.71:8.86
 *
 * The six numbers are page, left, top, width, height.
 */
const PDF_MARKER =
  /@pdf:\s*(?:"([^"]+)"|(\S+?)):(\d+):([+-]?\d+(?:\.\d+)?):([+-]?\d+(?:\.\d+)?):([+-]?\d+(?:\.\d+)?):([+-]?\d+(?:\.\d+)?)/;

export function parsePdfRef(line: string): PdfRef | undefined {
  const match = PDF_MARKER.exec(line);
  if (!match) {
    return undefined;
  }
  const rawPath = (match[1] ?? match[2] ?? "").trim();
  const page = Number(match[3]);
  const left = Number(match[4]);
  const top = Number(match[5]);
  const width = Number(match[6]);
  const height = Number(match[7]);
  if (!rawPath || !Number.isInteger(page) || page < 1) {
    return undefined;
  }
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return undefined;
  }
  return { rawPath, page, left, top, width, height };
}

export function parseTexRef(line: string): TexRef | undefined {
  const match = MARKER.exec(line);
  if (!match) {
    return undefined;
  }
  const rawPath = (match[1] ?? match[2] ?? "").trim();
  const startLine = Number(match[3]);
  const endLine = match[4] === undefined ? startLine : Number(match[4]);
  if (!rawPath || !Number.isInteger(startLine) || startLine < 1) {
    return undefined;
  }
  if (!Number.isInteger(endLine) || endLine < startLine) {
    return undefined;
  }
  return { rawPath, startLine, endLine };
}
