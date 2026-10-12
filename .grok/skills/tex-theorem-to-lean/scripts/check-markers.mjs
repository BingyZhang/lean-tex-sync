import fs from "node:fs";
import path from "node:path";

const texMarker = /@tex:\s*(?:"([^"]+)"|(\S+?)):(\d+)(?:-(\d+))?/g;
const pdfMarker =
  /@pdf:\s*(?:"([^"]+)"|(\S+?)):(\d+):([+-]?\d+(?:\.\d+)?):([+-]?\d+(?:\.\d+)?):([+-]?\d+(?:\.\d+)?):([+-]?\d+(?:\.\d+)?)/g;

function leanFiles(root) {
  if (fs.statSync(root).isFile()) {
    return [root];
  }
  const found = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...leanFiles(full));
    } else if (entry.name.endsWith(".lean")) {
      found.push(full);
    }
  }
  return found;
}

function resolveTex(raw, leanPath, paperRoot) {
  const beside = path.resolve(path.dirname(leanPath), raw);
  if (fs.existsSync(beside)) {
    return beside;
  }
  const fromPaper = path.resolve(paperRoot, raw);
  if (fs.existsSync(fromPaper)) {
    return fromPaper;
  }
  return undefined;
}

function check(paperRoot, leanRoot) {
  let errors = 0;
  for (const leanPath of leanFiles(leanRoot)) {
    const lines = fs.readFileSync(leanPath, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!line.trim()) {
        return;
      }
      const texMarkers = [...line.matchAll(texMarker)];
      const pdfMarkers = [...line.matchAll(pdfMarker)];
      if (texMarkers.length === 0 && pdfMarkers.length === 0) {
        console.error(`${leanPath}:${index + 1} has neither @tex nor @pdf`);
        errors += 1;
        return;
      }
      for (const marker of texMarkers) {
        const raw = marker[1] || marker[2];
        const start = Number(marker[3]);
        const end = marker[4] ? Number(marker[4]) : start;
        const texPath = resolveTex(raw, leanPath, paperRoot);
        if (!texPath) {
          console.error(`${leanPath}:${index + 1} missing TeX file ${raw}`);
          errors += 1;
          continue;
        }
        const texLineCount = fs.readFileSync(texPath, "utf8").split(/\r?\n/).length;
        if (start < 1 || end < start || end > texLineCount) {
          console.error(`${leanPath}:${index + 1} bad range ${raw}:${start}-${end}`);
          errors += 1;
        }
      }
      for (const marker of pdfMarkers) {
        const raw = marker[1] || marker[2];
        const page = Number(marker[3]);
        const width = Number(marker[6]);
        const height = Number(marker[7]);
        const pdfPath = resolveTex(raw, leanPath, paperRoot);
        if (!pdfPath) {
          console.error(`${leanPath}:${index + 1} missing PDF file ${raw}`);
          errors += 1;
          continue;
        }
        if (page < 1 || width <= 0 || height <= 0) {
          console.error(`${leanPath}:${index + 1} bad PDF rectangle in ${raw}`);
          errors += 1;
        }
      }
    });
  }
  return errors;
}

const paperRoot = process.argv[2];
const leanRoot = process.argv[3];
if (!paperRoot || !leanRoot) {
  console.error("usage: node check-markers.mjs <paper-dir> <lean-dir-or-file>");
  process.exit(1);
}
const errors = check(path.resolve(paperRoot), path.resolve(leanRoot));
if (errors > 0) {
  console.error(`${errors} marker error${errors === 1 ? "" : "s"}`);
  process.exit(1);
}
console.log("markers ok");
