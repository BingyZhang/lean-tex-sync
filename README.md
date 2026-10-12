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

在已经用 LaTeX Workshop 打开 TeX 和 PDF 的窗口里，点一行带 `@tex:` 的 Lean 会先把 TeX 光标放过去，再调用 LaTeX Workshop 的 SyncTeX，所以原来的 PDF 也会跳。没有 `@tex:` 或 `@pdf:` 注释的 Lean 行对不上任何位置，状态栏会写「这一行没有 @tex 或 @pdf 注释」。

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
