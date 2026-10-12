export interface PdfRect {
  page: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

const PDF_MARKER =
  /@pdf:\s*(?:"[^"]+"|\S+?):\d+:[+-]?\d+(?:\.\d+)?:[+-]?\d+(?:\.\d+)?:[+-]?\d+(?:\.\d+)?:[+-]?\d+(?:\.\d+)?/;

export function upsertPdfComment(line: string, annotation: string): string {
  if (PDF_MARKER.test(line)) {
    return line.replace(PDF_MARKER, annotation);
  }
  return `${line} ${annotation}`;
}

export function formatPdfComment(pdfPath: string, box: PdfRect): string {
  const shown = /[\s:]/.test(pdfPath) ? `"${pdfPath}"` : pdfPath;
  const n = (value: number) => value.toFixed(2);
  return `@pdf: ${shown}:${box.page}:${n(box.left)}:${n(box.top)}:${n(box.width)}:${n(box.height)}`;
}

export function boxFromSynctexPoint(hit: {
  page: number;
  h: number;
  v: number;
  width: number;
  height: number;
}): PdfRect | undefined {
  if (hit.page < 1 || hit.width <= 0 || hit.height <= 0) {
    return undefined;
  }
  return {
    page: hit.page,
    left: hit.h,
    top: hit.v - hit.height,
    width: hit.width,
    height: hit.height,
  };
}
