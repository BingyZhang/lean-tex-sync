---
name: tex-theorem-to-lean
description: >
  Strictly verify every theorem, lemma, proposition, corollary, and its proof from a cryptographic paper in VCVio and Lean. Each proof step cites the source sentence it implements.
  Use when the user says "convert theorems to Lean", "verify with VCVio", "tex to lean", "pdf to lean", or asks any coding agent (Claude, GPT, Gemini, Grok, Cursor Agent, GitHub Copilot) to follow this file.
---

# Theorems to Lean

Comment syntax is in this repo's `README.md`. `@pdf` numbers are page, left, top, width, height in points from the top-left of the page.

Write Lean under `<paper>/lean/`. One declaration per environment. Every non-empty line carries a citation of the source line that step implements. A statement line cites the statement. A proof line cites the proof sentence, not the whole theorem. Do not invent coordinates or line numbers.

The goal is strict verification. Every cryptographic theorem and every proof in the paper must be a Lean theorem that `lake env lean` accepts inside VCVio, with a proof term that derives the paper's conclusion. A `structure`, a `sorry`, or a proof that is the hypothesis returned unchanged is not verification. If the paper says the proof is left to a full version and the local text does not contain the argument, do not invent it and do not mark that environment verified. Report it as unverified and continue with the environments whose proofs are present.

## From TeX

Search `*.tex` for `theorem`, `lemma`, `proposition`, and `corollary`. Skip an environment whose `\begin` line is commented out with `%`. Translate every remaining environment, including repeated labels. Cite with `@tex: path:line` or `@tex: path:start-end`, path relative to the Lean file.

```lean
theorem distinguisherRefutes {T : OpenTheory} (sem : Semantics T) {Δ : PortBoundary}
    {real ideal : T.Obj Δ} (K : T.Plug Δ) {ε : ℝ≥0∞} -- @tex: ../sections/ImpossibilityGORO.tex:33
    (hadv : (1 : ℝ≥0∞) / 2 ≤ sem.distAdvantage (T.close real K) (T.close ideal K)) -- @tex: ../sections/ImpossibilityGORO.tex:60
    (hε : ε < (1 : ℝ≥0∞) / 2) :
    ¬ ObservedCompEmulates sem ε real ideal := by -- @tex: ../sections/ImpossibilityGORO.tex:33
  intro hem -- @tex: ../sections/ImpossibilityGORO.tex:36
  exact lt_irrefl ε (lt_of_lt_of_le hε (le_trans hadv (hem K))) -- @tex: ../sections/ImpossibilityGORO.tex:60
```

The hypothesis `hadv` is the paper's concrete distinguisher. It is not verified until that plug is defined and the inequality is proved. Do not count the theorem above as a finished impossibility proof while `hadv` is assumed.

If `<name>.pdf` and `<name>.synctex.gz` sit together, stamp from the plugin repo. Do not write `@pdf` by hand in this case.

```bash
node scripts/write-pdf-sync.mjs <paper>/<name>.pdf <paper>/lean
```

A TeX file that was not `\input` into that PDF has no box. Leave those lines without `@pdf` and report them.

## From a PDF only

There is no `.tex` and no `.synctex.gz`. Do not write `@tex`.

Read the PDF text with positions. PyMuPDF's `page.get_text("dict")` boxes use the same top-left point space as `@pdf`. Group words on one baseline into one visual line. For each Lean line, set `@pdf` from the visual line it translates. Several visual lines become one rectangle: left and top are the minima, width and height reach the maxima. If no extracted line matches, leave the Lean line unmarked and report it.

```lean
theorem factor (ε adv : ℝ≥0∞) :
    (2 : ℝ≥0∞) * (1 - ε) * adv = (2 - 2 * ε) * adv := by -- @pdf: ../main.pdf:12:134.76:220.10:345.83:8.86
  have h : (2 : ℝ≥0∞) * (1 - ε) = 2 * 1 - 2 * ε := -- @pdf: ../main.pdf:12:134.76:231.40:345.83:8.86
    ENNReal.mul_sub (fun _ _ => by norm_num) -- @pdf: ../main.pdf:12:134.76:231.40:345.83:8.86
```

## VCVio

A paper is cryptographic when it states an advantage, indistinguishability, UC or GUC realization, zero-knowledge, commitment, encryption, signature, or random-oracle claim. Check those files inside `/Users/bingsheng/Documents/OneDrive - ICSR/Document/Grok工程/密码学证明` (Lean `v4.34.0`). A bare `lean` that only sees Init is not the check.

Import `VCVio.Interaction.UC.Computational` for UC and GUC claims, and `VCVio.OracleComp.ProbComp` plus `VCVio.EvalDist.Monad.Basic` for oracle programs and event probabilities. Build the UC module first with `lake build VCVio.Interaction.UC.Computational` from the VCVio root. A realization judgment is `ObservedCompUCSecure` or `ObservedCompEmulates`. Distinguishing advantage is `Semantics.distAdvantage`. Event probability is `𝒟[experiment] {x | p x}`. `Pr` is deprecated. Mark a definition that uses either as `noncomputable`.

Encode the protocol, the oracle, and the ideal functionality as objects of one `OpenTheory`, and the adversary and environment as plugs. Each hybrid hop is a proved `ObservedCompEmulates sem ε Hi Hj` from those programs. Chain hops with `ObservedCompEmulates.triangle`. Identical hybrids use `ObservedCompEmulates.refl`. Weaken a bound with `ObservedCompEmulates.mono`. A reduction is a function between adversaries together with `SecurityGame.secureAgainst_of_reduction` or `SecurityGame.secureAgainst_of_ucEmulation`. An impossibility is `¬ ObservedCompEmulates sem ε real ideal`, proved from a defined plug whose `distAdvantage` exceeds `ε`. A finished theorem has no hypothesis that restates its conclusion.

```bash
cd "/Users/bingsheng/Documents/OneDrive - ICSR/Document/Grok工程/密码学证明"
lake env lean <paper>/lean/Theorems.lean
```

## Verify

1. For a cryptographic paper, the `lake env lean` command above exits 0. For any other paper, `lean <paper>/lean/*.lean` exits 0.
2. `node .grok/skills/tex-theorem-to-lean/scripts/check-markers.mjs <paper> <paper>/lean` exits 0. Each non-empty line has `@tex` or `@pdf`. A `@tex` range lies inside that file. A tactic line (`intro`, `exact`, `rw`, `have`, `simpa`, `omega`, and the same sort) must cite a line inside a `proof` environment; citing only the theorem statement fails. A `@pdf` file exists, the page is at least 1, and the width and height are positive.
3. After SyncTeX stamping, run the checker again. Report how many `@pdf` markers were written and which TeX files had none.

The report lists every environment. An environment is verified only when its Lean theorem has a complete proof under the rule above. List unverified environments separately and say which proof text is missing. Do not summarize them as done.
