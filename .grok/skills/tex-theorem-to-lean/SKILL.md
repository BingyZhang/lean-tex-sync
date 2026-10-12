---
name: tex-theorem-to-lean
description: >
  Translate theorem, lemma, proposition, and corollary environments from LaTeX or from a PDF into Lean. Each Lean proof step cites the source line it implements: a TeX line when source exists, or a PDF text-line rectangle when only a PDF is given.
  Use when the user says "convert theorems to Lean", "tex to lean", "pdf to lean", "mark tex lines", "mark pdf lines", "stamp pdf sync", or asks any coding agent (Claude, GPT, Gemini, Grok, Cursor Agent, GitHub Copilot) to follow this file.
---

# Theorems to Lean

Comment syntax is in this repo's `README.md`. `@pdf` numbers are page, left, top, width, height in points from the top-left of the page.

Write Lean under `<paper>/lean/`. One declaration per environment. Every non-empty line carries a citation of the source line that step implements. A statement line cites the statement. A proof line cites the proof sentence, not the whole theorem. Do not invent coordinates or line numbers.

Prove a calculation or a logical step when the source gives explicit premises and a different conclusion. `omega`, `rw`, and `exact` are enough. A step the source only names, or defers, is a field of a `structure`. Do not give that structure the type `Prop` when a field itself has type `Prop`. Do not use `sorry`, and do not add a theorem whose proof is the hypothesis restated.

## From TeX

Search `*.tex` for `theorem`, `lemma`, `proposition`, and `corollary`. Skip an environment whose `\begin` line is commented out with `%`. Translate every remaining environment, including repeated labels. Cite with `@tex: path:line` or `@tex: path:start-end`, path relative to the Lean file.

```lean
theorem lowerboundsCommitGoro (protocol simulator : Prop)
    (realizes : protocol → simulator)
    (distinguishes : simulator → False) : ¬ protocol := by -- @tex: ../sections/ImpossibilityGORO.tex:33
  intro assumption -- @tex: ../sections/ImpossibilityGORO.tex:36
  exact distinguishes (realizes assumption) -- @tex: ../sections/ImpossibilityGORO.tex:36
```

If `<name>.pdf` and `<name>.synctex.gz` sit together, stamp from the plugin repo. Do not write `@pdf` by hand in this case.

```bash
node scripts/write-pdf-sync.mjs <paper>/<name>.pdf <paper>/lean
```

A TeX file that was not `\input` into that PDF has no box. Leave those lines without `@pdf` and report them.

## From a PDF only

There is no `.tex` and no `.synctex.gz`. Do not write `@tex`.

Read the PDF text with positions. PyMuPDF's `page.get_text("dict")` boxes use the same top-left point space as `@pdf`. Group words on one baseline into one visual line. For each Lean line, set `@pdf` from the visual line it translates. Several visual lines become one rectangle: left and top are the minima, width and height reach the maxima. If no extracted line matches, leave the Lean line unmarked and report it.

```lean
theorem factor (ε adv : Nat) :
    2 * (1 - ε) * adv = (2 - 2 * ε) * adv := by -- @pdf: ../main.pdf:12:134.76:220.10:345.83:8.86
  have h := Nat.mul_sub_left_distrib 2 1 ε -- @pdf: ../main.pdf:12:134.76:231.40:345.83:8.86
```

## Verify

1. `lean <paper>/lean/*.lean` elaborates with no errors.
2. `node .grok/skills/tex-theorem-to-lean/scripts/check-markers.mjs <paper> <paper>/lean` exits 0. Each non-empty line has `@tex` or `@pdf`. A `@tex` range lies inside that file. A `@pdf` file exists, the page is at least 1, and the width and height are positive.
3. After SyncTeX stamping, run the checker again. Report how many `@pdf` markers were written and which TeX files had none.

The report lists each environment, whether Lean proves it or only records it, and which source line each proof step cites.
