import { execFile } from "node:child_process";
import * as path from "node:path";

/** A forward hit. Coordinates are PDF big points from the top-left of the page. */
export interface SyncView {
  page: number;
  x: number;
  y: number;
  h: number;
  v: number;
  width: number;
  height: number;
}

export interface SyncEdit {
  input: string;
  /** 1-based TeX line. */
  line: number;
}

export function parseSynctexView(stdout: string): SyncView | undefined {
  const record = firstRecord(stdout);
  if (!record) {
    return undefined;
  }
  const page = numberField(record, "Page");
  const x = numberField(record, "x");
  const y = numberField(record, "y");
  const h = numberField(record, "h");
  const v = numberField(record, "v");
  const width = numberField(record, "W");
  const height = numberField(record, "H");
  if (
    page === undefined ||
    x === undefined ||
    y === undefined ||
    h === undefined ||
    v === undefined ||
    width === undefined ||
    height === undefined
  ) {
    return undefined;
  }
  return { page, x, y, h, v, width, height };
}

export function parseSynctexEdit(stdout: string): SyncEdit | undefined {
  const record = firstRecord(stdout);
  if (!record) {
    return undefined;
  }
  const input = record.get("Input");
  const line = numberField(record, "Line");
  if (!input || line === undefined || line < 1) {
    return undefined;
  }
  return { input, line };
}

export interface SyncOutcome<T> {
  value?: T;
  output: string;
}

export async function synctexView(
  binary: string,
  pdfPath: string,
  texPath: string,
  line: number,
): Promise<SyncOutcome<SyncView>> {
  const directory = path.dirname(pdfPath);
  const inputs = [...new Set([path.relative(directory, texPath), path.basename(texPath), texPath])];
  let output = "";
  for (const input of inputs) {
    if (!input) {
      continue;
    }
    output = await run(binary, ["view", "-i", `${line}:0:${input}`, "-o", pdfPath], directory);
    const value = parseSynctexView(output);
    if (value) {
      return { value, output };
    }
  }
  return { output };
}

export async function synctexEdit(
  binary: string,
  pdfPath: string,
  page: number,
  x: number,
  y: number,
): Promise<SyncOutcome<SyncEdit>> {
  const output = await run(
    binary,
    ["edit", "-o", `${page}:${round(x)}:${round(y)}:${pdfPath}`],
    path.dirname(pdfPath),
  );
  return { value: parseSynctexEdit(output), output };
}

function round(value: number): string {
  return value.toFixed(2);
}

function firstRecord(stdout: string): Map<string, string> | undefined {
  const begin = stdout.indexOf("SyncTeX result begin");
  if (begin < 0) {
    return undefined;
  }
  const end = stdout.indexOf("SyncTeX result end", begin);
  const body = stdout.slice(begin, end < 0 ? undefined : end);
  const record = new Map<string, string>();
  for (const line of body.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    record.set(line.slice(0, separator), line.slice(separator + 1).trim());
  }
  return record;
}

function numberField(record: Map<string, string>, key: string): number | undefined {
  const raw = record.get(key);
  if (raw === undefined || raw === "") {
    return undefined;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function run(binary: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(binary, args, { cwd, timeout: 8000 }, (_error, stdout, stderr) => {
      resolve(`${stdout ?? ""}\n${stderr ?? ""}`);
    });
  });
}
