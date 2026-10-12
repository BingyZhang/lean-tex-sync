# Lean TeX Sync

VS Code / Cursor 插件。左边是 LaTeX 或 PDF，右边是 Lean。点一边的某一行，另一边高亮对应的行。

对应关系写在 Lean 行里，不写在 LaTeX 里。生成 Lean 时，给每一行带上它来自的 TeX 位置：

```lean
theorem successProbability : True := by -- @tex: demo.tex:5
  trivial -- @tex: demo.tex:5
```

也接受单独一行注释、行范围，以及带空格的路径：

```lean
-- @tex: Snarky_STMS/5-security.tex:88-96
sorry /- @tex: "my file.tex":12 -/
```

路径相对这个 Lean 文件、相对工作区根目录，或者写绝对路径。行号从 1 开始，范围包含两端。多行 Lean 可以指向同一行 TeX；点那行 TeX 时，这些 Lean 行都会高亮。

PDF 不另写行号。插件用 TeX 发行版里的 `synctex`，把注释里的 TeX 行换成 PDF 上的位置，反过来也一样。本机已有 `/Library/TeX/texbin/synctex`。PDF 需要和 TeX 一起编译出的 `文件名.synctex.gz`。

## 打开

1. 用 VS Code 或 Cursor 打开这个目录。
2. 在终端运行 `npm install`，然后 `npm test`。
3. 按 F5，选择 **Run Lean TeX Sync**。它会新开一个窗口，并打开 `examples/`。
4. 在新窗口里打开 `Demo.lean`，运行命令 **Lean TeX: 左右对照打开**。左边是 `demo.tex`，右边是 Lean。
5. 点 Lean 的某一行，左边那一行变黄。点 TeX 的某一行，右边对应的 Lean 行变蓝。
6. 运行 **Lean TeX: 左侧打开 PDF**。之后点 Lean 会在 PDF 上画出高亮；点 PDF 会高亮右边的 Lean。

光标移动就会同步。设置里可以把 `leanTexSync.syncOnCursor` 关掉，只在命令 **Lean TeX: 从光标同步** 时跳转。

没有 `@tex:` 或 `@pdf:` 注释的行对不上任何位置，状态栏会写「这一行没有 @tex 或 @pdf 注释」。

焦点留在你点的那一边。TeX 和 PDF 在旁边的栏里高亮，不会把当前文件盖住。两个开关在设置里搜 `leanTexSync`：

- `highlightTex`：点 Lean 时高亮 TeX。默认开。
- `highlightPdf`：点 Lean 或 TeX 时高亮 PDF。默认开。有 `@pdf:` 就用注释里的方框，没有才用 SyncTeX 现算。

## 交给只有 PDF 的人

编译 PDF 时带上 `-synctex=1`（LaTeX Workshop 和 latexmk 默认会写）。编译结束、旁边出现 `.synctex.gz` 之后，插件会自己把每个 `@tex:` 行号写成同一行上的 `@pdf:` 方框，不用再运行 `node`。设置 `leanTexSync.stampOnBuild` 可以关掉。

也可以手动跑同一件事：

```bash
node scripts/write-pdf-sync.mjs examples/demo.pdf examples
```

```lean
theorem successProbability : True := by -- @tex: demo.tex:5 @pdf: demo.pdf:1:133.77:127.85:343.71:8.86
```

六个数字是页码、左、上、宽、高，单位是点，原点在页面左上角。PDF 重新排版后要再跑一次脚本。

对方打开 PDF 和 Lean，不需要 TeX 源文件。点 Lean 按 `@pdf:` 高亮 PDF；点 PDF 上同一横条高亮对应的 Lean 行。TeX 文件还在时，`@tex:` 照旧对 LaTeX。

输出面板 **Lean TeX Sync** 会写索引结果，以及 SyncTeX 没有命中时的原因。

## 和转换说明配套

插件只读 Lean 行里的注释，不从论文里找定理。转换步骤写在 `.grok/skills/tex-theorem-to-lean/SKILL.md`。这份说明不绑定某一个模型。把该文件和论文目录交给任何编程助手即可，例如 Claude、GPT、Gemini、Grok，或编辑器里的 Cursor Agent、GitHub Copilot。

1. 放进工作区的可以是带 `.tex` 的论文目录，也可以只有一份 PDF。有 TeX 又要标 PDF 时，还要有一起编译出来的 `名字.pdf` 和 `名字.synctex.gz`。
2. 让模型按 `SKILL.md` 做，并说「把定理转成 Lean」。例如：

```text
Read .grok/skills/tex-theorem-to-lean/SKILL.md and convert the theorems in papers/my-paper to Lean.
```

```text
请按 .grok/skills/tex-theorem-to-lean/SKILL.md，把 papers/my-paper 里的定理转成 Lean。
```

3. 模型会把 theorem、lemma、proposition、corollary 写成 `<论文>/lean/` 下的 Lean。证明的每一步标它对应的那一句，不把整段定理标成同一个范围。有 TeX 时用 `@tex: 相对路径:行号`。只有 PDF 时，按页面上的文字行写 `@pdf:`，不写 `@tex`。算式和反证会写成能通过 `lean` 的证明。论文只是点名、或者证明放在全文版里的结论，记成 `structure`，不用 `sorry`。
4. 有 TeX 且目录里有 SyncTeX 时，按说明运行下面的命令，由它填写 `@pdf:`。不要在这种情况下手填坐标。只有 PDF 时跳过这一步，坐标来自上一步抽出的文字行。

```bash
node scripts/write-pdf-sync.mjs <论文>/名字.pdf <论文>/lean
```

没有被这份 PDF `\input` 进去的 tex 文件不会有 `@pdf:`。不要手填坐标。
5. 用装了本插件的 VS Code 或 Cursor 打开同一工作区。点 Lean 高亮 TeX 和 PDF；点 TeX 高亮 Lean 和 PDF；点 PDF 上的黄条，Lean 跳到对应行。

检查行号：

```bash
node .grok/skills/tex-theorem-to-lean/scripts/check-markers.mjs <论文目录> <论文目录>/lean
# 密码学论文在 VCVio 工程里检查，不要只用裸的 lean
cd "/Users/bingsheng/Documents/OneDrive - ICSR/Document/Grok工程/密码学证明"
lake env lean <论文目录>/lean/Theorems.lean
```

`examples/ACproceeding` 是本地试跑用的论文，没有放进仓库。试跑结果写在该目录的 `lean/Theorems.lean`：编进 `mainCom.pdf` 的源文件有 `@pdf:`，`GPRO.tex`、`GORO.tex`、`Appendix.tex`、`newAppendix.tex` 没有，因为 `mainCom.tex` 没有 `\input` 它们。
