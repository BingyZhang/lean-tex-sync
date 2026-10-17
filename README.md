# Lean TeX Sync

A VS Code and Cursor extension. LaTeX or a PDF is on the left, Lean is on the right. Click a line on one side and the matching line is highlighted on the other.

The correspondence lives in the Lean line, not in the LaTeX. When Lean is generated, every line carries the TeX position it came from:

```lean
theorem successProbability : True := by -- @tex: demo.tex:5
  trivial -- @tex: demo.tex:5
```

A comment on its own line, a line range, and a path that contains spaces are also accepted:

```lean
-- @tex: Snarky_STMS/5-security.tex:88-96
sorry /- @tex: "my file.tex":12 -/
```

A path may be relative to the Lean file, relative to the workspace root, or absolute. Line numbers start at 1, and a range includes both ends. Several Lean lines may point at one TeX line. Clicking that TeX line highlights all of them.

PDF positions are not written by hand. The extension uses the `synctex` binary from the TeX distribution to turn a TeX line in a comment into a position on the PDF, and the other way around. This machine has `/Library/TeX/texbin/synctex`. The PDF needs the `filename.synctex.gz` produced by compiling it together with the TeX.

## Open it

1. Open this directory in VS Code or Cursor.
2. In a terminal, run `npm install`, then `npm test`.
3. Press F5 and choose **Run Lean TeX Sync**. A new window opens on `examples/`.
4. In that window, open `Demo.lean` and run **Lean TeX: 左右对照打开** (open side by side). The left editor is `demo.tex` and the right editor is Lean.
5. Click a Lean line and the matching TeX line turns yellow. Click a TeX line and the matching Lean lines turn blue.
6. Run **Lean TeX: 左侧打开 PDF** (open the PDF on the left). After that, clicking Lean draws a highlight on the PDF, and clicking the PDF highlights the Lean on the right.

Moving the cursor synchronizes the two sides. Set `leanTexSync.syncOnCursor` to off if the jump should happen only on **Lean TeX: 从光标同步** (sync from the cursor).

A line with neither an `@tex:` nor an `@pdf:` comment matches nothing. The status bar then reads “这一行没有 @tex 或 @pdf 注释” (this line has no `@tex` or `@pdf` comment).

Focus stays on the side you clicked. TeX and PDF are highlighted in the neighboring column and do not replace the current file. Both switches are under `leanTexSync` in Settings:

- `highlightTex`: highlight TeX when Lean is clicked. On by default.
- `highlightPdf`: highlight the PDF when Lean or TeX is clicked. On by default. An `@pdf:` comment supplies the box. SyncTeX is used only when that comment is absent.

## Hand someone only the PDF

Compile the PDF with `-synctex=1`. LaTeX Workshop and latexmk write SyncTeX by default. After the build finishes and `.synctex.gz` is beside the PDF, the extension writes an `@pdf:` box onto every line that has `@tex:`. No separate `node` command is required. `leanTexSync.stampOnBuild` turns this off.

The same step can be run by hand:

```bash
node scripts/write-pdf-sync.mjs examples/demo.pdf examples
```

```lean
theorem successProbability : True := by -- @tex: demo.tex:5 @pdf: demo.pdf:1:133.77:127.85:343.71:8.86
```

The six numbers are page, left, top, width, and height, in points, with the origin at the top-left of the page. Run the script again after the PDF is laid out again.

The other person opens the PDF and the Lean. They do not need the TeX sources. Clicking Lean highlights the PDF from `@pdf:`. Clicking the same horizontal band on the PDF highlights the Lean line. When the TeX file is still present, `@tex:` continues to match the LaTeX.

The **Lean TeX Sync** output channel records the index and the reason SyncTeX missed a line.

## Use it with the conversion instructions

The extension reads comments on Lean lines. It does not search the paper for theorems. The conversion steps are in `.grok/skills/tex-theorem-to-lean/SKILL.md`. Those instructions are not tied to one model. Give that file and the paper directory to any coding assistant: Claude, GPT, Gemini, Grok, Cursor Agent, or GitHub Copilot.

1. The workspace may contain a paper directory with `.tex` files, or only a PDF. When both TeX and PDF marks are wanted, the directory also needs the `name.pdf` and `name.synctex.gz` produced by one compilation.
2. Ask the model to follow `SKILL.md` and convert the theorems to Lean. For example:

```text
Read .grok/skills/tex-theorem-to-lean/SKILL.md and convert the theorems in papers/my-paper to Lean.
```

```text
请按 .grok/skills/tex-theorem-to-lean/SKILL.md，把 papers/my-paper 里的定理转成 Lean。
```

3. The model writes every theorem, lemma, proposition, corollary, and its proof as Lean under `<paper>/lean/`, and checks it with `lake env lean` inside the VCVio project. Each proof step cites the sentence it implements. With TeX, the citation is `@tex: relative/path:line`. With only a PDF, the citation is an `@pdf:` box for a line of text on the page, and there is no `@tex`. A cryptographic conclusion has to be VCVio’s `ObservedCompEmulates`, `ObservedCompUCSecure`, or `distAdvantage`, and the proof has to derive it from the protocol program. A `sorry`, a proof that returns its hypothesis, or a bare `structure` is not verification. Every hybrid, union bound, product of independent leaks, and algebraic slack written in the paper becomes a Lean proof. A hypothesis is allowed only for a primitive advantage the paper names and does not derive, or for a count the paper states without listing the summands. That hypothesis is marked unverified. When the paper leaves the proof to a full version and the local text has no proof, the environment is marked unverified.
4. When TeX and SyncTeX are both present, run the command below and let it fill in `@pdf:`. Skip this step when the input is only a PDF: the coordinates then come from the text lines extracted in the previous step.

```bash
node scripts/write-pdf-sync.mjs <paper>/name.pdf <paper>/lean
```

A `.tex` file that this PDF does not `\input` receives no `@pdf:`. Leave those coordinates unset.
5. Open the same workspace in VS Code or Cursor with this extension installed. Clicking Lean highlights TeX and the PDF. Clicking TeX highlights Lean and the PDF. Clicking a yellow band on the PDF jumps Lean to the matching line.

Check the line numbers:

```bash
node .grok/skills/tex-theorem-to-lean/scripts/check-markers.mjs <paper> <paper>/lean
# Check a cryptographic paper inside the VCVio project.
cd "/Users/bingsheng/Documents/OneDrive - ICSR/Document/Grok工程/密码学证明"
lake env lean <paper>/lean/Theorems.lean
```

`examples/ACproceeding` is a local trial paper and is not in the repository. Its result is `lean/Theorems.lean` in that directory. Sources compiled into `mainCom.pdf` have `@pdf:`. `GPRO.tex`, `GORO.tex`, `Appendix.tex`, and `newAppendix.tex` do not, because `mainCom.tex` does not `\input` them.
