import * as path from "node:path";
import { parsePdfRef, parseTexRef } from "./parse";

export interface PdfBox {
  /** Normalized absolute PDF path. */
  pdfPath: string;
  page: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Link {
  leanPath: string;
  /** 0-based Lean line. */
  leanLine: number;
  /** Normalized absolute LaTeX path. Absent when the line only has `@pdf:`. */
  texPath?: string;
  /** 0-based inclusive LaTeX lines. */
  texStart?: number;
  texEnd?: number;
  pdf?: PdfBox;
}

export interface PathResolver {
  exists(fsPath: string): boolean;
  realPath(fsPath: string): string;
}

/** Resolve the path written in a comment. Missing files still resolve next to the Lean file. */
export function resolveTexPath(
  rawPath: string,
  leanPath: string,
  workspaceRoots: readonly string[],
  resolver: PathResolver,
): string {
  const candidates: string[] = [];
  if (path.isAbsolute(rawPath)) {
    candidates.push(rawPath);
  } else {
    candidates.push(path.resolve(path.dirname(leanPath), rawPath));
    const leanRoot = workspaceRoots.find((root) => isInside(leanPath, root));
    const roots = leanRoot
      ? [leanRoot, ...workspaceRoots.filter((root) => root !== leanRoot)]
      : [...workspaceRoots];
    for (const root of roots) {
      candidates.push(path.resolve(root, rawPath));
    }
  }
  for (const candidate of candidates) {
    if (resolver.exists(candidate)) {
      return resolver.realPath(candidate);
    }
  }
  return candidates[0] ?? path.resolve(rawPath);
}

export function linksFromLeanText(
  leanPath: string,
  text: string,
  workspaceRoots: readonly string[],
  resolver: PathResolver,
): Link[] {
  const links: Link[] = [];
  const lines = text.split(/\r?\n/);
  for (let line = 0; line < lines.length; line++) {
    const text = lines[line] ?? "";
    const ref = parseTexRef(text);
    const pdf = parsePdfRef(text);
    if (!ref && !pdf) {
      continue;
    }
    links.push({
      leanPath,
      leanLine: line,
      texPath: ref ? resolveTexPath(ref.rawPath, leanPath, workspaceRoots, resolver) : undefined,
      texStart: ref ? ref.startLine - 1 : undefined,
      texEnd: ref ? ref.endLine - 1 : undefined,
      pdf: pdf
        ? {
            pdfPath: resolveTexPath(pdf.rawPath, leanPath, workspaceRoots, resolver),
            page: pdf.page,
            left: pdf.left,
            top: pdf.top,
            width: pdf.width,
            height: pdf.height,
          }
        : undefined,
    });
  }
  return links;
}

export class LinkIndex {
  private readonly byLean = new Map<string, Link[]>();
  private readonly byTex = new Map<string, Link[]>();
  private readonly byPdf = new Map<string, Link[]>();

  replaceLean(leanPath: string, links: readonly Link[]): void {
    this.forgetLean(leanPath);
    const stored = links.map((link) => ({ ...link, leanPath }));
    this.byLean.set(leanPath, stored);
    for (const link of stored) {
      if (link.texPath !== undefined) {
        pushBucket(this.byTex, link.texPath, link);
      }
      if (link.pdf) {
        pushBucket(this.byPdf, link.pdf.pdfPath, link);
      }
    }
  }

  forgetLean(leanPath: string): void {
    const previous = this.byLean.get(leanPath);
    if (!previous) {
      return;
    }
    this.byLean.delete(leanPath);
    for (const link of previous) {
      if (link.texPath !== undefined) {
        dropBucket(this.byTex, link.texPath, leanPath);
      }
      if (link.pdf) {
        dropBucket(this.byPdf, link.pdf.pdfPath, leanPath);
      }
    }
  }

  linkAtLean(leanPath: string, leanLine: number): Link | undefined {
    return this.byLean.get(leanPath)?.find((link) => link.leanLine === leanLine);
  }

  firstInLean(leanPath: string): Link | undefined {
    return this.byLean.get(leanPath)?.[0];
  }

  anyForTex(texPath: string): Link | undefined {
    return this.byTex.get(texPath)?.[0];
  }

  /** Every Lean line whose comment covers this LaTeX line. */
  hitsForTex(texPath: string, texLine: number): Link[] {
    return (this.byTex.get(texPath) ?? []).filter(
      (link) =>
        link.texStart !== undefined &&
        link.texEnd !== undefined &&
        link.texStart <= texLine &&
        texLine <= link.texEnd,
    );
  }

  /**
   * Lean lines whose PDF rectangle covers this point.
   * A click on the same horizontal band counts, so the highlight is not limited to the glyph box.
   */
  hitsForPdf(pdfPath: string, page: number, x: number, y: number): Link[] {
    const slop = 4;
    const vertical = (this.byPdf.get(pdfPath) ?? []).filter((link) => {
      const box = link.pdf;
      return (
        box !== undefined &&
        box.page === page &&
        box.top - slop <= y &&
        y <= box.top + box.height + slop
      );
    });
    const inside = vertical.filter((link) => {
      const box = link.pdf;
      return box !== undefined && box.left - slop <= x && x <= box.left + box.width + slop;
    });
    return inside.length > 0 ? inside : vertical;
  }
}

function pushBucket(map: Map<string, Link[]>, key: string, link: Link): void {
  const bucket = map.get(key);
  if (bucket) {
    bucket.push(link);
  } else {
    map.set(key, [link]);
  }
}

function dropBucket(map: Map<string, Link[]>, key: string, leanPath: string): void {
  const bucket = map.get(key);
  if (!bucket) {
    return;
  }
  const rest = bucket.filter((item) => item.leanPath !== leanPath);
  if (rest.length === 0) {
    map.delete(key);
  } else {
    map.set(key, rest);
  }
}

function isInside(filePath: string, root: string): boolean {
  const relative = path.relative(root, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
