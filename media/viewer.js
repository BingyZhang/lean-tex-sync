const vscode = acquireVsCodeApi();
const cfg = JSON.parse(document.getElementById("cfg").textContent);
const pdfjsLib = await import(cfg.pdfjs).catch((error) => {
  document.getElementById("status").textContent = "Could not load PDF.js.";
  vscode.postMessage({ type: "error", message: String(error) });
  return undefined;
});
if (pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = cfg.worker;
}

const pagesEl = document.getElementById("pages");
const statusEl = document.getElementById("status");

/** @type {import('pdfjs-dist').PDFDocumentProxy | null} */
let pdf = null;
/** @type {PageView[]} */
let views = [];
/** @type {object | null} */
let pendingHighlight = null;

/**
 * @typedef {object} PageView
 * @property {number} pageNumber
 * @property {any} page
 * @property {{width: number, height: number}} base
 * @property {HTMLElement} wrap
 * @property {HTMLCanvasElement} canvas
 * @property {HTMLElement} overlay
 * @property {any} viewport
 * @property {any} renderTask
 * @property {number} renderedScale
 */

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        void renderWrap(/** @type {HTMLElement} */ (entry.target));
      }
    }
  },
  { rootMargin: "900px 0px" },
);

window.addEventListener("message", (event) => {
  const message = event.data;
  if (message?.type === "load") {
    void load(message);
  } else if (message?.type === "highlight") {
    void highlight(message);
  }
});

vscode.postMessage({ type: "ready" });

let loadedKey = "";

async function load(message) {
  const key = message.url || `bytes:${message.data?.byteLength ?? message.data?.length ?? 0}`;
  if (pdf && key === loadedKey) {
    if (pendingHighlight) {
      const queued = pendingHighlight;
      pendingHighlight = null;
      await highlight(queued);
    }
    return;
  }
  loadedKey = key;
  statusEl.textContent = "Opening PDF…";
  observer.disconnect();
  for (const view of views) {
    view.renderTask?.cancel();
  }
  views = [];
  pagesEl.replaceChildren();
  try {
    if (!pdfjsLib) {
      return;
    }
    const source = message.url ? { url: message.url } : { data: toBytes(message.data) };
    const task = pdfjsLib.getDocument({
      ...source,
      cMapUrl: cfg.cmap,
      cMapPacked: true,
      standardFontDataUrl: cfg.fonts,
      isEvalSupported: false,
    });
    pdf = await task.promise;
  } catch (error) {
    statusEl.textContent = "Could not open this PDF.";
    vscode.postMessage({ type: "error", message: String(error) });
    return;
  }
  const first = await pdf.getPage(1);
  const base = first.getViewport({ scale: 1 });
  for (let number = 1; number <= pdf.numPages; number++) {
    const wrap = document.createElement("div");
    wrap.className = "page";
    wrap.dataset.page = String(number);
    wrap.style.height = `${base.height}px`;
    const canvas = document.createElement("canvas");
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    canvas.addEventListener("click", (event) => void onClick(number, event));
    wrap.append(canvas, overlay);
    pagesEl.append(wrap);
    views.push({
      pageNumber: number,
      page: number === 1 ? first : undefined,
      base,
      wrap,
      canvas,
      overlay,
      viewport: undefined,
      renderTask: undefined,
      renderedScale: 0,
    });
    observer.observe(wrap);
  }
  statusEl.textContent = "";
  if (pendingHighlight) {
    const queued = pendingHighlight;
    pendingHighlight = null;
    await highlight(queued);
  }
}

async function onClick(pageNumber, event) {
  const view = views[pageNumber - 1];
  if (!view) {
    return;
  }
  if (!view.viewport) {
    await renderWrap(view.wrap);
  }
  if (!view.viewport) {
    return;
  }
  const [pdfX, pdfY] = view.viewport.convertToPdfPoint(event.offsetX, event.offsetY);
  vscode.postMessage({
    type: "click",
    page: pageNumber,
    x: pdfX,
    y: view.base.height - pdfY,
  });
}

async function highlight(message) {
  if (!pdf) {
    pendingHighlight = message;
    return;
  }
  const view = views[message.page - 1];
  if (!view) {
    statusEl.textContent = `PDF has no page ${message.page}.`;
    return;
  }
  view.wrap.scrollIntoView({ block: "center" });
  await renderWrap(view.wrap);
  if (!view.viewport) {
    return;
  }
  for (const other of views) {
    other.overlay.replaceChildren();
    other.overlay.style.display = "none";
  }
  const [x1, y1] = view.viewport.convertToViewportPoint(message.left, view.base.height - message.top);
  const [x2, y2] = view.viewport.convertToViewportPoint(
    message.left + message.width,
    view.base.height - (message.top + message.height),
  );
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const width = Math.max(Math.abs(x2 - x1), 2);
  const height = Math.max(Math.abs(y2 - y1), 4);
  const band = document.createElement("div");
  band.className = "band";
  band.style.top = `${top}px`;
  band.style.height = `${height}px`;
  const box = document.createElement("div");
  box.className = "box";
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
  box.style.width = `${width}px`;
  box.style.height = `${height}px`;
  view.overlay.append(band, box);
  view.overlay.style.display = "block";
  box.scrollIntoView({ block: "center", inline: "nearest" });
}

async function ensurePage(view) {
  if (view.page || !pdf) {
    return;
  }
  view.page = await pdf.getPage(view.pageNumber);
  view.base = view.page.getViewport({ scale: 1 });
  view.wrap.style.height = `${view.base.height}px`;
}

async function renderWrap(wrap) {
  const view = views[Number(wrap.dataset.page) - 1];
  if (!view) {
    return;
  }
  await ensurePage(view);
  if (!view.page) {
    return;
  }
  const available = Math.max(pagesEl.clientWidth - 24, 200);
  const scale = available / view.base.width;
  if (view.viewport && Math.abs(view.renderedScale - scale) < 0.02) {
    return;
  }
  const viewport = view.page.getViewport({ scale });
  view.canvas.width = Math.floor(viewport.width);
  view.canvas.height = Math.floor(viewport.height);
  view.wrap.style.width = `${viewport.width}px`;
  view.wrap.style.height = `${viewport.height}px`;
  view.renderTask?.cancel();
  const task = view.page.render({ canvasContext: view.canvas.getContext("2d"), viewport });
  view.renderTask = task;
  try {
    await task.promise;
  } catch (error) {
    if (error?.name === "RenderingCancelledException") {
      return;
    }
    vscode.postMessage({ type: "error", message: String(error) });
    return;
  }
  view.viewport = viewport;
  view.renderedScale = scale;
}

function toBytes(data) {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (Array.isArray(data)) {
    return Uint8Array.from(data);
  }
  if (data?.data && Array.isArray(data.data)) {
    return Uint8Array.from(data.data);
  }
  return new Uint8Array(data);
}

window.addEventListener("resize", () => {
  for (const view of views) {
    view.renderedScale = 0;
    if (view.wrap.getBoundingClientRect().bottom > -400 && view.wrap.getBoundingClientRect().top < window.innerHeight + 400) {
      void renderWrap(view.wrap);
    }
  }
});
