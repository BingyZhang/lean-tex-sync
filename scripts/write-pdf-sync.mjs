import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEX_MARKER = /@tex:\s*(?:"([^"]+)"|(\S+?)):(\d+)(?:-(\d+))?/;
const PDF_MARKER =
  /@pdf:\s*(?:"[^"]+"|\S+?):\d+:[+-]?\d+(?:\.\d+)?:[+-]?\d+(?:\.\d+)?:[+-]?\d+(?:\.\d+)?:[+-]?\d+(?:\.\d+)?/;

export function upsertPdfComment(line, annotation) {
  if (PDF_MARKER.test(line)) {
    return line.replace(PDF_MARKER, annotation);
  }
  return `${line} ${annotation}`;
}

export function boxFromSynctex(record) {
  const page = numberField(record, "Page");
  const left = numberField(record, "h");
  const baseline = numberField(record, "v");
  const width = numberField(record, "W");
  const height = numberField(record, "H");
  if (
    page === undefined ||
    left === undefined ||
    baseline === undefined ||
    width === undefined ||
    height === undefined ||
    page < 1 ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }
  return { page, left, top: baseline - height, width, height };
}

export function formatPdfComment(pdfPath, box) {
  const shown = /[\s:]/.test(pdfPath) ? `"${pdfPath}"` : pdfPath;
  const n = (value) => value.toFixed(2);
  return `@pdf: ${shown}:${box.page}:${n(box.left)}:${n(box.top)}:${n(box.width)}:${n(box.height)}`;
}

export function parseSynctexRecord(stdout) {
  const begin = stdout.indexOf("SyncTeX result begin");
  if (begin < 0) {
    return undefined;
  }
  const end = stdout.indexOf("SyncTeX result end", begin);
  const record = new Map();
  for (const line of stdout.slice(begin, end < 0 ? undefined : end).split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator > 0) {
      record.set(line.slice(0, separator), line.slice(separator + 1).trim());
    }
  }
  return record;
}

function numberField(record, key) {
  const value = Number(record.get(key));
  return Number.isFinite(value) ? value : undefined;
}

function synctexBinary() {
  if (process.env.SYNCTEX) {
    return process.env.SYNCTEX;
  }
  if (fs.existsSync("/Library/TeX/texbin/synctex")) {
    return "/Library/TeX/texbin/synctex";
  }
  return "synctex";
}

function run(binary, args, cwd) {
  return new Promise((resolve) => {
    execFile(binary, args, { cwd, timeout: 8000 }, (_error, stdout, stderr) => {
      resolve(`${stdout ?? ""}\n${stderr ?? ""}`);
    });
  });
}

async function locate(pdfPath, texPath, line) {
  const directory = path.dirname(pdfPath);
  const inputs = [...new Set([path.relative(directory, texPath), path.basename(texPath), texPath])].filter(Boolean);
  for (const input of inputs) {
    const output = await run(synctexBinary(), ["view", "-i", `${line}:0:${input}`, "-o", pdfPath], directory);
    const record = parseSynctexRecord(output);
    const box = record ? boxFromSynctex(record) : undefined;
    if (box) {
      return box;
    }
  }
  return undefined;
}

function leanFiles(root) {
  const found = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".lake" || entry.name === ".git" || entry.name === "out") {
        continue;
      }
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".lean")) {
        found.push(full);
      }
    }
  };
  walk(root);
  return found;
}

function resolveTex(rawPath, leanPath) {
  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }
  const beside = path.resolve(path.dirname(leanPath), rawPath);
  if (fs.existsSync(beside)) {
    return beside;
  }
  return beside;
}

export async function writePdfSync(pdfPath, roots) {
  const pdf = path.resolve(pdfPath);
  let changed = 0;
  let missed = 0;
  for (const root of roots) {
    for (const leanPath of leanFiles(path.resolve(root))) {
      const original = fs.readFileSync(leanPath, "utf8");
      const lines = original.split(/\r?\n/);
      let dirty = false;
      for (let index = 0; index < lines.length; index++) {
        const match = TEX_MARKER.exec(lines[index]);
        if (!match) {
          continue;
        }
        const texPath = resolveTex(match[1] ?? match[2], leanPath);
        const line = Number(match[3]);
        const box = await locate(pdf, texPath, line);
        if (!box) {
          missed += 1;
          console.warn(`no SyncTeX box for ${path.basename(leanPath)}:${index + 1} -> ${texPath}:${line}`);
          continue;
        }
        const relativePdf = path.relative(path.dirname(leanPath), pdf).split(path.sep).join("/");
        const next = upsertPdfComment(lines[index], formatPdfComment(relativePdf, box));
        if (next !== lines[index]) {
          lines[index] = next;
          dirty = true;
          changed += 1;
        }
      }
      if (dirty) {
        const text = lines.join("\n");
        fs.writeFileSync(leanPath, original.endsWith("\n") && !text.endsWith("\n") ? `${text}\n` : text);
      }
    }
  }
  return { changed, missed };
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const pdfPath = process.argv[2];
  const roots = process.argv.slice(3);
  if (!pdfPath || roots.length === 0) {
    console.error("usage: node scripts/write-pdf-sync.mjs file.pdf lean-dir ...");
    process.exit(1);
  }
  const result = await writePdfSync(pdfPath, roots);
  console.log(`wrote ${result.changed} @pdf marker${result.changed === 1 ? "" : "s"}, ${result.missed} missed`);
}
