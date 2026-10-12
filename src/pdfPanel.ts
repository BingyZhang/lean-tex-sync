import * as path from "node:path";
import * as vscode from "vscode";

export interface PdfHighlight {
  page: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PdfClick {
  page: number;
  x: number;
  y: number;
}

export class PdfPanel {
  static current: PdfPanel | undefined;

  pdfPath: string | undefined;

  private readonly panel: vscode.WebviewPanel;
  private ready: Promise<void>;
  private markReady!: () => void;

  private constructor(
    extensionUri: vscode.Uri,
    private readonly onClick: (click: PdfClick) => void,
    private readonly onError: (message: string) => void,
  ) {
    this.ready = new Promise((resolve) => {
      this.markReady = resolve;
    });
    this.panel = vscode.window.createWebviewPanel(
      "leanTexSync.pdf",
      "PDF",
      { viewColumn: columnBesideActive(), preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: localRoots(extensionUri),
      },
    );
    this.panel.webview.html = html(this.panel.webview, extensionUri);
    this.panel.webview.onDidReceiveMessage((message: { type?: string; message?: string; page?: number; x?: number; y?: number }) => {
      if (message?.type === "ready") {
        this.markReady();
      } else if (message?.type === "click" && message.page && message.x !== undefined && message.y !== undefined) {
        this.onClick({ page: message.page, x: message.x, y: message.y });
      } else if (message?.type === "error") {
        this.onError(message.message ?? "PDF viewer error");
      }
    });
    this.panel.onDidDispose(() => {
      if (PdfPanel.current === this) {
        PdfPanel.current = undefined;
      }
    });
  }

  static show(
    extensionUri: vscode.Uri,
    onClick: (click: PdfClick) => void,
    onError: (message: string) => void,
  ): PdfPanel {
    if (PdfPanel.current) {
      PdfPanel.current.revealIfHidden();
      return PdfPanel.current;
    }
    const panel = new PdfPanel(extensionUri, onClick, onError);
    PdfPanel.current = panel;
    return panel;
  }

  async load(pdfPath: string): Promise<void> {
    if (this.pdfPath === pdfPath) {
      return;
    }
    this.pdfPath = pdfPath;
    this.panel.title = path.basename(pdfPath);
    await this.ready;
    const url = webviewFileUri(this.panel.webview, pdfPath);
    if (url) {
      await this.panel.webview.postMessage({ type: "load", url });
      return;
    }
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(pdfPath));
    await this.panel.webview.postMessage({ type: "load", data: bytes });
  }

  async highlight(box: PdfHighlight): Promise<void> {
    this.revealIfHidden();
    await this.ready;
    await this.panel.webview.postMessage({ type: "highlight", ...box });
  }

  private revealIfHidden(): void {
    if (!this.panel.visible) {
      this.panel.reveal(this.panel.viewColumn, true);
    }
  }
}

function html(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = Math.random().toString(36).slice(2);
  const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "viewer.js"));
  const pdfjs = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "node_modules", "pdfjs-dist", "build", "pdf.mjs"),
  );
  const worker = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "node_modules", "pdfjs-dist", "build", "pdf.worker.mjs"),
  );
  const cmap = directoryUri(webview, extensionUri, ["node_modules", "pdfjs-dist", "cmaps"]);
  const fonts = directoryUri(webview, extensionUri, ["node_modules", "pdfjs-dist", "standard_fonts"]);
  const cfg = JSON.stringify({ pdfjs: String(pdfjs), worker: String(worker), cmap, fonts });
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    `worker-src ${webview.cspSource} blob:`,
    `connect-src ${webview.cspSource}`,
    "img-src blob: data:",
  ].join("; ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PDF</title>
  <style>
    html, body { margin: 0; height: 100%; background: #2b2b2b; color: #ddd; }
    #status { min-height: 1.4em; padding: 6px 12px; font: 12px sans-serif; }
    #pages { display: flex; flex-direction: column; align-items: center; padding-bottom: 24px; }
    .page { position: relative; margin: 8px 0; background: white; }
    .page canvas { display: block; }
    .overlay { position: absolute; inset: 0; pointer-events: none; display: none; }
    .band { position: absolute; left: 0; right: 0; background: rgba(255, 196, 0, 0.35); }
    .box { position: absolute; outline: 2px solid rgba(180, 90, 0, 0.95); }
  </style>
</head>
<body>
  <div id="status"></div>
  <div id="pages"></div>
  <script id="cfg" type="application/json">${cfg}</script>
  <script nonce="${nonce}" type="module" src="${script}"></script>
</body>
</html>`;
}

function localRoots(extensionUri: vscode.Uri): vscode.Uri[] {
  const folders = vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? [];
  return [extensionUri, ...folders];
}

function webviewFileUri(webview: vscode.Webview, fsPath: string): string | undefined {
  const roots = [
    ...(vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? []),
  ];
  if (!roots.some((root) => isInside(fsPath, root))) {
    return undefined;
  }
  return String(webview.asWebviewUri(vscode.Uri.file(fsPath)));
}

function isInside(filePath: string, root: string): boolean {
  const relative = path.relative(root, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function columnBesideActive(): vscode.ViewColumn {
  return vscode.window.activeTextEditor?.viewColumn === vscode.ViewColumn.Two
    ? vscode.ViewColumn.One
    : vscode.ViewColumn.Two;
}

function directoryUri(webview: vscode.Webview, extensionUri: vscode.Uri, parts: string[]): string {
  const uri = String(webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...parts)));
  return uri.endsWith("/") ? uri : `${uri}/`;
}
