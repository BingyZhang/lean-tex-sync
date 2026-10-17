import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { Link, LinkIndex, linksFromLeanText, resolveTexPath, type PdfBox, type PathResolver } from "./links";
import { parseTexRef } from "./parse";
import { boxFromSynctexPoint, formatPdfComment, upsertPdfComment } from "./pdfComment";
import { PdfPanel } from "./pdfPanel";
import { synctexEdit, synctexView } from "./synctex";

const index = new LinkIndex();
const output = vscode.window.createOutputChannel("Lean TeX Sync");
let texDecoration: vscode.TextEditorDecorationType;
let leanDecoration: vscode.TextEditorDecorationType;
let suppressDepth = 0;
let suppressUntil = 0;
let syncDepth = 0;
const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
let hostExtensionUri: vscode.Uri;
const stampTimers = new Map<string, ReturnType<typeof setTimeout>>();
const decoratedTex: vscode.TextEditor[] = [];
const decoratedLean: vscode.TextEditor[] = [];

const resolver: PathResolver = {
  exists: (fsPath) => {
    try {
      return fs.statSync(fsPath).isFile();
    } catch {
      return false;
    }
  },
  realPath: (fsPath) => {
    try {
      return fs.realpathSync(fsPath);
    } catch {
      return path.resolve(fsPath);
    }
  },
};

export function activate(context: vscode.ExtensionContext): void {
  hostExtensionUri = context.extensionUri;
  texDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: "rgba(255, 196, 0, 0.35)",
    isWholeLine: true,
    overviewRulerColor: "rgba(255, 160, 0, 0.95)",
    overviewRulerLane: vscode.OverviewRulerLane.Full,
  });
  leanDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: "rgba(80, 180, 255, 0.32)",
    isWholeLine: true,
    overviewRulerColor: "rgba(80, 180, 255, 0.95)",
    overviewRulerLane: vscode.OverviewRulerLane.Full,
  });

  status.name = "Lean TeX Sync";
  status.command = "leanTexSync.syncCursor";
  status.text = "$(link) Lean TeX";
  status.show();
  context.subscriptions.push(
    texDecoration,
    leanDecoration,
    output,
    status,
    vscode.workspace.onDidOpenTextDocument(indexDocument),
    vscode.workspace.onDidChangeTextDocument((event) => indexDocument(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (isLean(document) && document.uri.scheme === "file") {
        index.forgetLean(fileKey(document.uri));
      }
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      const kind = event.kind;
      const fromUser =
        kind === vscode.TextEditorSelectionChangeKind.Mouse ||
        kind === vscode.TextEditorSelectionChangeKind.Keyboard;
      if (
        !fromUser ||
        syncDepth > 0 ||
        suppressed() ||
        !syncOnCursor() ||
        event.textEditor !== vscode.window.activeTextEditor
      ) {
        return;
      }
      void runSync(() => syncFromEditor(event.textEditor));
    }),
    vscode.commands.registerCommand("leanTexSync.openPair", () => openPair(context.extensionUri)),
    vscode.commands.registerCommand("leanTexSync.openPdf", () => openPdf(context.extensionUri)),
    vscode.commands.registerCommand("leanTexSync.syncCursor", () => {
      const editor = vscode.window.activeTextEditor;
      return editor ? runSync(() => syncFromEditor(editor)) : undefined;
    }),
    vscode.commands.registerCommand("leanTexSync.reindex", () => reindexWorkspace()),
    ...syncFileWatchers(),
  );

  for (const document of vscode.workspace.textDocuments) {
    indexDocument(document);
  }
  void reindexWorkspace();
}

export function deactivate(): void {
  PdfPanel.current = undefined;
  for (const timer of stampTimers.values()) {
    clearTimeout(timer);
  }
  stampTimers.clear();
}

function syncFileWatchers(): vscode.Disposable[] {
  const watch = (pattern: string) => {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const schedule = (uri: vscode.Uri) => scheduleStamp(uri.fsPath);
    watcher.onDidCreate(schedule);
    watcher.onDidChange(schedule);
    return watcher;
  };
  return [watch("**/*.synctex.gz"), watch("**/*.synctex")];
}

function scheduleStamp(artifactPath: string): void {
  if (!vscode.workspace.getConfiguration("leanTexSync").get<boolean>("stampOnBuild", true)) {
    return;
  }
  const pdfPath = pdfForSyncArtifact(artifactPath);
  if (!pdfPath || !resolver.exists(pdfPath)) {
    return;
  }
  const key = resolver.realPath(pdfPath);
  const pending = stampTimers.get(key);
  if (pending) {
    clearTimeout(pending);
  }
  stampTimers.set(
    key,
    setTimeout(() => {
      stampTimers.delete(key);
      void stampPdfMarkers(key);
    }, 1000),
  );
}

function pdfForSyncArtifact(fsPath: string): string | undefined {
  if (fsPath.endsWith(".synctex.gz")) {
    return `${fsPath.slice(0, -".synctex.gz".length)}.pdf`;
  }
  if (fsPath.endsWith(".synctex")) {
    return `${fsPath.slice(0, -".synctex".length)}.pdf`;
  }
  return undefined;
}

async function stampPdfMarkers(pdfPath: string): Promise<void> {
  const files = await vscode.workspace.findFiles("**/*.lean", "**/{.lake,node_modules,.git,out,dist}/**");
  const edit = new vscode.WorkspaceEdit();
  let changed = 0;
  for (const uri of files) {
    const open = vscode.workspace.textDocuments.find((document) => document.uri.fsPath === uri.fsPath);
    let text: string;
    if (open) {
      text = open.getText();
    } else {
      try {
        text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
      } catch {
        continue;
      }
    }
    if (!text.includes("@tex:")) {
      continue;
    }
    const document = open ?? (await vscode.workspace.openTextDocument(uri));
    const newline = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    const lines = document.getText().split(/\r?\n/);
    let dirty = false;
    for (let index = 0; index < lines.length; index++) {
      const ref = parseTexRef(lines[index] ?? "");
      if (!ref) {
        continue;
      }
      const texPath = resolveTexPath(ref.rawPath, document.uri.fsPath, workspaceRoots(), resolver);
      const hit = await synctexView(synctexBinary(), pdfPath, texPath, ref.startLine);
      const box = hit.value ? boxFromSynctexPoint(hit.value) : undefined;
      if (!box) {
        continue;
      }
      const relativePdf = path.relative(path.dirname(document.uri.fsPath), pdfPath).split(path.sep).join("/");
      const next = upsertPdfComment(lines[index] ?? "", formatPdfComment(relativePdf, box));
      if (next !== lines[index]) {
        lines[index] = next;
        dirty = true;
        changed += 1;
      }
    }
    if (!dirty) {
      continue;
    }
    const last = document.lineAt(document.lineCount - 1).range.end;
    edit.replace(document.uri, new vscode.Range(0, 0, last.line, last.character), lines.join(newline));
  }
  if (changed === 0) {
    return;
  }
  const applied = await vscode.workspace.applyEdit(edit);
  if (applied) {
    output.appendLine(`Wrote ${changed} @pdf marker${changed === 1 ? "" : "s"} from ${path.basename(pdfPath)}.`);
    status.text = `$(check) PDF coordinates ${changed}`;
    status.show();
  }
}

async function openPair(extensionUri: vscode.Uri): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  let leanUri: vscode.Uri | undefined;
  let texPath: string | undefined;
  let pdfPath: string | undefined;

  if (editor && isLean(editor.document)) {
    indexDocument(editor.document);
    leanUri = editor.document.uri;
    const here = index.linkAtLean(fileKey(leanUri), editor.selection.active.line) ?? index.firstInLean(fileKey(leanUri));
    texPath = here?.texPath;
    pdfPath = here?.pdf?.pdfPath;
  } else if (editor && isTex(editor.document)) {
    texPath = fileKey(editor.document.uri);
    leanUri = firstLeanFor(texPath, editor.selection.active.line);
  }

  if (!leanUri) {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { Lean: ["lean"] },
      title: "Lean file on the right",
    });
    leanUri = picked?.[0];
  }
  if (!texPath) {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { LaTeX: ["tex", "ltx"] },
      title: "LaTeX file on the left",
    });
    texPath = picked?.[0] ? fileKey(picked[0]) : undefined;
  }
  if (!leanUri) {
    return;
  }
  if (!texPath && pdfPath) {
    await openPdfAt(extensionUri, pdfPath);
    await guard(async () => {
      const leanDocument = await vscode.workspace.openTextDocument(leanUri!);
      await vscode.window.showTextDocument(leanDocument, {
        viewColumn: vscode.ViewColumn.Two,
        preview: false,
      });
    });
    const leanEditor = visibleEditor(fileKey(leanUri));
    if (leanEditor) {
      await runSync(() => syncFromLean(leanEditor));
    }
    return;
  }
  if (!texPath) {
    return;
  }

  await guard(async () => {
    const texDocument = await vscode.workspace.openTextDocument(texPath!);
    const leanDocument = await vscode.workspace.openTextDocument(leanUri!);
    await vscode.window.showTextDocument(texDocument, {
      viewColumn: vscode.ViewColumn.One,
      preview: false,
    });
    await vscode.window.showTextDocument(leanDocument, {
      viewColumn: vscode.ViewColumn.Two,
      preview: false,
    });
  });
  const leanEditor = visibleEditor(fileKey(leanUri));
  if (leanEditor) {
    await runSync(() => syncFromLean(leanEditor));
  }
}

async function openPdf(extensionUri: vscode.Uri): Promise<void> {
  const hinted = currentPdfPath() ?? (await currentTexPath().then((texPath) => (texPath ? findPdf(texPath) : undefined)));
  let pdfPath = hinted;
  if (!pdfPath) {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { PDF: ["pdf"] },
      title: "PDF on the left",
    });
    pdfPath = picked?.[0]?.fsPath;
  }
  if (!pdfPath) {
    return;
  }
  await openPdfAt(extensionUri, pdfPath);
  const editor = vscode.window.activeTextEditor;
  if (editor && isLean(editor.document)) {
    await runSync(() => syncFromLean(editor));
  }
}

async function openPdfAt(extensionUri: vscode.Uri, pdfPath: string): Promise<void> {
  const panel = PdfPanel.show(
    extensionUri,
    (click) => {
      const current = PdfPanel.current?.pdfPath;
      if (current) {
        void onPdfClick(current, click);
      }
    },
    (message) => output.appendLine(message),
  );
  await panel.load(resolver.realPath(pdfPath));
}

async function onPdfClick(pdfPath: string, click: { page: number; x: number; y: number }): Promise<void> {
  await runSync(() => onPdfClickInner(pdfPath, click));
}

async function onPdfClickInner(pdfPath: string, click: { page: number; x: number; y: number }): Promise<void> {
  const pdfKey = resolver.realPath(pdfPath);
  const pdfHits = index.hitsForPdf(pdfKey, click.page, click.x, click.y);
  const result = await synctexEdit(synctexBinary(), pdfPath, click.page, click.x, click.y);
  const texHits: Link[] = [];
  if (result.value) {
    const texPath = resolver.realPath(result.value.input);
    const texLine = result.value.line - 1;
    const texEditor = visibleEditor(texPath);
    if (texEditor) {
      await showTexRange(texEditor, texLine, texLine);
    }
    texHits.push(...index.hitsForTex(texPath, texLine));
  } else if (pdfHits.length === 0) {
    output.appendLine(result.output.trim() || "No Lean @pdf rectangle and no SyncTeX hit at that PDF point.");
  }
  const hits = dedupeLinks([...pdfHits, ...texHits]);
  await showLeanLinks(hits);
  const texPath = result.value ? resolver.realPath(result.value.input) : undefined;
  await highlightClickedPdf(pdfKey, click, hits, texPath, result.value?.line);
}

async function highlightClickedPdf(
  pdfPath: string,
  click: { page: number; x: number; y: number },
  hits: readonly Link[],
  texPath: string | undefined,
  texLine: number | undefined,
): Promise<void> {
  const panel = PdfPanel.current;
  if (!panel) {
    return;
  }
  const boxed = hits.filter((hit) => hit.pdf?.pdfPath === pdfPath);
  boxed.sort((a, b) => {
    const ay = a.pdf!.top + a.pdf!.height / 2;
    const by = b.pdf!.top + b.pdf!.height / 2;
    return Math.abs(ay - click.y) - Math.abs(by - click.y);
  });
  const stored = boxed[0]?.pdf;
  if (stored) {
    await panel.highlight(stored);
    return;
  }
  if (texLine === undefined) {
    return;
  }
  if (!texPath) {
    return;
  }
  const forward = await synctexView(synctexBinary(), pdfPath, texPath, texLine);
  const box = forward.value ? boxFromSynctexPoint(forward.value) : undefined;
  if (!box) {
    return;
  }
  await panel.highlight(box);
}

async function syncFromEditor(editor: vscode.TextEditor): Promise<void> {
  if (editor.document.uri.scheme !== "file") {
    return;
  }
  if (isLean(editor.document)) {
    await syncFromLean(editor);
  } else if (isTex(editor.document)) {
    const line = editor.selection.active.line;
    await showLeanHits(fileKey(editor.document.uri), line);
    markTex(editor, line, line);
    if (highlightPdfEnabled()) {
      await highlightPdfAtTexLine(fileKey(editor.document.uri), line);
    }
  }
}

async function syncFromLean(editor: vscode.TextEditor): Promise<void> {
  indexDocument(editor.document);
  const link = index.linkAtLean(fileKey(editor.document.uri), editor.selection.active.line);
  clearTex();
  if (!link) {
    status.text = "$(warning) This line has no @tex or @pdf comment";
    status.show();
    return;
  }
  const texOnDisk =
    link.texPath !== undefined &&
    link.texStart !== undefined &&
    link.texEnd !== undefined &&
    resolver.exists(link.texPath);
  const labels: string[] = [];
  if (
    highlightTexEnabled() &&
    texOnDisk &&
    link.texPath !== undefined &&
    link.texStart !== undefined &&
    link.texEnd !== undefined
  ) {
    labels.push(`${path.basename(link.texPath)}:${link.texStart + 1}`);
    await showTexRange(visibleEditor(link.texPath), link.texStart, link.texEnd, link.texPath);
  }
  if (link.pdf && highlightPdfEnabled()) {
    labels.push(`${path.basename(link.pdf.pdfPath)} p.${link.pdf.page}`);
    await showPdfBox(link.pdf, true);
  } else if (texOnDisk && link.texPath !== undefined && link.texStart !== undefined && highlightPdfEnabled()) {
    await highlightPdfAtTexLine(link.texPath, link.texStart);
  }
  if (labels.length > 0) {
    status.text = `$(link) ${labels.join(" · ")}`;
  }
  status.show();
}

async function showPdfBox(box: PdfBox, openIfClosed: boolean): Promise<void> {
  if (!resolver.exists(box.pdfPath)) {
    output.appendLine(`PDF not found: ${box.pdfPath}`);
    return;
  }
  if (!PdfPanel.current && !openIfClosed) {
    return;
  }
  const panel = PdfPanel.show(
    hostExtensionUri,
    (click) => {
      const current = PdfPanel.current?.pdfPath;
      if (current) {
        void onPdfClick(current, click);
      }
    },
    (message) => output.appendLine(message),
  );
  if (!panel.pdfPath || resolver.realPath(panel.pdfPath) !== box.pdfPath) {
    await panel.load(box.pdfPath);
  }
  await panel.highlight(box);
}

async function showTexRange(
  existing: vscode.TextEditor | undefined,
  startLine: number,
  endLine: number,
  texPath?: string,
): Promise<void> {
  clearTex();
  const editor = existing ?? (texPath ? await openEditor(texPath, vscode.ViewColumn.Beside) : undefined);
  if (!editor) {
    return;
  }
  const last = editor.document.lineCount - 1;
  const start = clamp(startLine, 0, last);
  const end = clamp(endLine, start, last);
  await guard(async () => {
    const range = new vscode.Range(start, 0, end, editor.document.lineAt(end).text.length);
    editor.setDecorations(texDecoration, [range]);
    editor.selection = new vscode.Selection(start, 0, start, 0);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  });
  remember(decoratedTex, editor);
}

async function showLeanHits(texPath: string, texLine: number): Promise<void> {
  const hits = index.hitsForTex(resolver.realPath(texPath), texLine);
  if (hits.length === 0) {
    output.appendLine(`No Lean line has @tex pointing at ${path.basename(texPath)}:${texLine + 1}.`);
  }
  await showLeanLinks(hits);
}

async function showLeanLinks(hits: readonly Link[]): Promise<void> {
  clearLean();
  if (hits.length === 0) {
    return;
  }
  const groups = new Map<string, Link[]>();
  for (const hit of hits) {
    const bucket = groups.get(hit.leanPath) ?? [];
    bucket.push(hit);
    groups.set(hit.leanPath, bucket);
  }
  const preferred = [...groups.keys()].find((leanPath) => visibleEditor(leanPath)) ?? [...groups.keys()][0];
  for (const [leanPath, links] of groups) {
    const visible = visibleEditor(leanPath);
    if (!visible && leanPath !== preferred) {
      continue;
    }
    const editor = visible ?? (await openEditor(leanPath, vscode.ViewColumn.Two));
    if (!editor) {
      continue;
    }
    const ranges = links
      .filter((link) => link.leanLine < editor.document.lineCount)
      .map((link) => new vscode.Range(link.leanLine, 0, link.leanLine, editor.document.lineAt(link.leanLine).text.length));
    if (ranges.length === 0) {
      continue;
    }
    await guard(async () => {
      editor.setDecorations(leanDecoration, ranges);
      editor.selection = new vscode.Selection(ranges[0]!.start, ranges[0]!.start);
      editor.revealRange(ranges[0]!, vscode.TextEditorRevealType.InCenter);
    });
    remember(decoratedLean, editor);
  }
}

function dedupeLinks(links: readonly Link[]): Link[] {
  const seen = new Set<string>();
  const unique: Link[] = [];
  for (const link of links) {
    const key = `${link.leanPath}:${link.leanLine}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(link);
  }
  return unique;
}

function currentPdfPath(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== "file" || !isLean(editor.document)) {
    return undefined;
  }
  indexDocument(editor.document);
  const key = fileKey(editor.document.uri);
  return (
    index.linkAtLean(key, editor.selection.active.line)?.pdf?.pdfPath ??
    index.firstInLean(key)?.pdf?.pdfPath
  );
}

function markTex(editor: vscode.TextEditor, startLine: number, endLine: number): void {
  const last = editor.document.lineCount - 1;
  const start = clamp(startLine, 0, last);
  const end = clamp(endLine, start, last);
  const range = new vscode.Range(start, 0, end, editor.document.lineAt(end).text.length);
  editor.setDecorations(texDecoration, [range]);
  remember(decoratedTex, editor);
}

async function openEditor(fsPath: string, column: vscode.ViewColumn): Promise<vscode.TextEditor | undefined> {
  try {
    const document = await vscode.workspace.openTextDocument(fsPath);
    return await guard(() =>
      vscode.window.showTextDocument(document, { viewColumn: column, preserveFocus: true, preview: false }),
    );
  } catch (error) {
    output.appendLine(`Could not open ${fsPath}: ${String(error)}`);
    return undefined;
  }
}

function indexDocument(document: vscode.TextDocument): void {
  if (!isLean(document) || document.uri.scheme !== "file") {
    return;
  }
  const leanPath = fileKey(document.uri);
  index.replaceLean(leanPath, linksFromLeanText(leanPath, document.getText(), workspaceRoots(), resolver));
}

async function reindexWorkspace(): Promise<void> {
  const files = await vscode.workspace.findFiles("**/*.lean", "**/{.lake,node_modules,.git,out,dist}/**");
  let marked = 0;
  for (const uri of files) {
    const open = vscode.workspace.textDocuments.find((document) => document.uri.fsPath === uri.fsPath && document.isDirty);
    let text: string;
    if (open) {
      text = open.getText();
    } else {
      try {
        text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
      } catch {
        continue;
      }
    }
    if (!text.includes("@tex:") && !text.includes("@pdf:")) {
      continue;
    }
    const leanPath = fileKey(uri);
    index.replaceLean(leanPath, linksFromLeanText(leanPath, text, workspaceRoots(), resolver));
    marked += 1;
  }
  output.appendLine(`Indexed ${marked} Lean file${marked === 1 ? "" : "s"} with @tex or @pdf markers.`);
}

async function currentTexPath(): Promise<string | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== "file") {
    return undefined;
  }
  if (isTex(editor.document)) {
    return fileKey(editor.document.uri);
  }
  if (isLean(editor.document)) {
    indexDocument(editor.document);
    const key = fileKey(editor.document.uri);
    return index.linkAtLean(key, editor.selection.active.line)?.texPath ?? index.firstInLean(key)?.texPath;
  }
  return undefined;
}

function firstLeanFor(texPath: string, texLine: number): vscode.Uri | undefined {
  const hit = index.hitsForTex(texPath, texLine)[0] ?? index.anyForTex(texPath);
  return hit ? vscode.Uri.file(hit.leanPath) : undefined;
}

function findPdf(texPath: string): string | undefined {
  const directory = path.dirname(texPath);
  const candidates = [
    path.join(directory, `${path.basename(texPath, path.extname(texPath))}.pdf`),
    path.join(directory, "main.pdf"),
    path.join(path.dirname(directory), "main.pdf"),
  ];
  return candidates.find((candidate) => resolver.exists(candidate));
}

function visibleEditor(fsPath: string): vscode.TextEditor | undefined {
  let key: string;
  try {
    key = resolver.realPath(fsPath);
  } catch {
    key = path.resolve(fsPath);
  }
  return vscode.window.visibleTextEditors.find(
    (editor) => editor.document.uri.scheme === "file" && fileKey(editor.document.uri) === key,
  );
}

function fileKey(uri: vscode.Uri): string {
  return resolver.realPath(uri.fsPath);
}

function workspaceRoots(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
}

function isLean(document: vscode.TextDocument): boolean {
  return document.languageId === "lean" || document.languageId === "lean4" || document.uri.fsPath.endsWith(".lean");
}

function isTex(document: vscode.TextDocument): boolean {
  return document.languageId === "latex" || document.languageId === "tex" || /\.(tex|ltx)$/.test(document.uri.fsPath);
}

function syncOnCursor(): boolean {
  return vscode.workspace.getConfiguration("leanTexSync").get<boolean>("syncOnCursor", true);
}

function highlightTexEnabled(): boolean {
  return vscode.workspace.getConfiguration("leanTexSync").get<boolean>("highlightTex", true);
}

function highlightPdfEnabled(): boolean {
  return vscode.workspace.getConfiguration("leanTexSync").get<boolean>("highlightPdf", true);
}

function synctexBinary(): string {
  const configured = vscode.workspace.getConfiguration("leanTexSync").get<string>("synctexPath", "").trim();
  if (configured) {
    return configured;
  }
  if (fs.existsSync("/Library/TeX/texbin/synctex")) {
    return "/Library/TeX/texbin/synctex";
  }
  return "synctex";
}

function clearTex(): void {
  clearDecorations(decoratedTex, texDecoration);
}

function clearLean(): void {
  clearDecorations(decoratedLean, leanDecoration);
}

function clearDecorations(
  list: vscode.TextEditor[],
  decoration: vscode.TextEditorDecorationType,
): void {
  for (const editor of list) {
    try {
      editor.setDecorations(decoration, []);
    } catch {
      // The editor may already have been closed.
    }
  }
  list.length = 0;
}

function remember(list: vscode.TextEditor[], editor: vscode.TextEditor): void {
  if (!list.includes(editor)) {
    list.push(editor);
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

async function highlightPdfAtTexLine(texPath: string, line: number): Promise<void> {
  const pdfPath = PdfPanel.current?.pdfPath ?? findPdf(texPath);
  if (!pdfPath || !resolver.exists(pdfPath)) {
    output.appendLine(`No PDF next to ${path.basename(texPath)}.`);
    return;
  }
  const hit = await synctexView(synctexBinary(), pdfPath, texPath, line + 1);
  const box = hit.value ? boxFromSynctexPoint(hit.value) : undefined;
  if (!box) {
    output.appendLine(hit.output.trim() || `SyncTeX has no PDF position for ${path.basename(texPath)}:${line + 1}.`);
    return;
  }
  await showPdfBox({ pdfPath: resolver.realPath(pdfPath), ...box }, true);
}

async function runSync(action: () => Promise<void>): Promise<void> {
  if (syncDepth > 0) {
    return;
  }
  syncDepth += 1;
  try {
    await action();
  } finally {
    suppressUntil = Date.now() + 600;
    syncDepth -= 1;
  }
}

function suppressed(): boolean {
  return suppressDepth > 0 || Date.now() < suppressUntil;
}

async function guard<T>(action: () => PromiseLike<T>): Promise<T> {
  suppressDepth += 1;
  try {
    return await action();
  } finally {
    suppressUntil = Date.now() + 250;
    suppressDepth -= 1;
  }
}
