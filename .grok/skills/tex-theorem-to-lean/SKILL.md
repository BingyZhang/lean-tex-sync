---
name: tex-theorem-to-lean
description: >
  Translate theorem, lemma, proposition, and corollary environments from a LaTeX paper into Lean, with one @tex line citation on every Lean line and @pdf rectangles when a SyncTeX file exists.
  Use when the user says "convert theorems to Lean", "tex to lean", "mark tex lines", "stamp pdf sync", or runs /tex-theorem-to-lean.
---

# TeX theorems to Lean

Work from the paper directory that contains the `.tex` sources. The comment syntax is the one in this repo's `README.md`: `@tex: path:line` or `@tex: path:start-end`, and `@pdf: path:page:left:top:width:height` written only by `scripts/write-pdf-sync.mjs`.

## Inventory

Search `*.tex` for `theorem`, `lemma`, `proposition`, and `corollary` environments. Skip an environment whose `\begin` line is commented out with `%`. Translate every remaining environment, including repeated labels in different files. Record the inclusive line range of the environment, from its `\begin` line through its `\end` line.

## Lean

Write the Lean under `<paper>/lean/`. One declaration per environment. Cite that environment's range on every line of its declaration, as a path relative to the Lean file.

```lean
theorem lowerboundsCommitGoro (protocol simulator : Prop)
    (realizes : protocol → simulator)
    (distinguishes : simulator → False) : ¬ protocol := by -- @tex: ../sections/ImpossibilityGORO.tex:32-34
  intro assumption -- @tex: ../sections/ImpossibilityGORO.tex:32-34
  exact distinguishes (realizes assumption) -- @tex: ../sections/ImpossibilityGORO.tex:32-34
```

Prove a calculation or a logical step when the environment, or the proof that follows it in the same file, gives explicit premises and a different conclusion. `omega`, `rw`, and `exact` are enough for the arithmetic and contradiction steps. A step the paper only names, or defers to a full version, is a field of a `structure`. Do not give that structure the type `Prop` when a field itself has type `Prop`; Lean then expects the field to be a proof. Do not use `sorry`, and do not add a theorem whose proof is the hypothesis restated.

Every non-empty line carries an `@tex` citation. Do not invent `@pdf` numbers.

## PDF

If a PDF and a sibling `.synctex.gz` are in the paper directory, stamp from the plugin repo:

```bash
node scripts/write-pdf-sync.mjs <paper>/<name>.pdf <paper>/lean
```

The script resolves each `@tex` path next to the Lean file and asks SyncTeX for a box. A line in a file that was not `\input` into that PDF has no box. Leave it without `@pdf` and report it. Do not copy coordinates from another file.

## Verify

1. `lean <paper>/lean/*.lean` elaborates with no errors. Use the `lean` on `PATH`.
2. `node .grok/skills/tex-theorem-to-lean/scripts/check-markers.mjs <paper> <paper>/lean` exits 0. It checks that every non-empty Lean line has `@tex`, that the path exists relative to the Lean file or the paper root, and that the cited lines lie inside the file.
3. Re-run the checker after stamping. Report how many `@pdf` markers were written and which environments have none because SyncTeX has no tag for that source file.

The report lists each environment, whether Lean proves it or only records it, and whether `@pdf` was stamped.
