import assert from "node:assert/strict";
import test from "node:test";
import { LinkIndex, linksFromLeanText, resolveTexPath, type PathResolver } from "./links";

const files = new Map<string, string>([
  ["/paper/Demo.lean", ""],
  ["/paper/demo.tex", ""],
  ["/paper/sections/5.tex", ""],
]);

const resolver: PathResolver = {
  exists: (fsPath) => files.has(fsPath),
  realPath: (fsPath) => fsPath,
};

test("resolves a path next to the Lean file before a workspace root", () => {
  files.set("/other/demo.tex", "");
  const resolved = resolveTexPath("demo.tex", "/paper/Demo.lean", ["/other", "/paper"], resolver);
  assert.equal(resolved, "/paper/demo.tex");
  files.delete("/other/demo.tex");
});

test("resolves a workspace-relative path when it is not next to the Lean file", () => {
  const resolved = resolveTexPath(
    "sections/5.tex",
    "/paper/proofs/Demo.lean",
    ["/paper"],
    resolver,
  );
  assert.equal(resolved, "/paper/sections/5.tex");
});

test("indexes a comment and finds every Lean line that covers a TeX line", () => {
  const index = new LinkIndex();
  const text = [
    "def title : String := \"Sign\" -- @tex: demo.tex:4",
    "theorem one : True := by -- @tex: demo.tex:5-6",
    "  trivial -- @tex: demo.tex:5",
    "theorem plain : True := trivial",
  ].join("\n");
  index.replaceLean("/paper/Demo.lean", linksFromLeanText("/paper/Demo.lean", text, ["/paper"], resolver));

  assert.equal(index.linkAtLean("/paper/Demo.lean", 0)?.texStart, 3);
  assert.equal(index.linkAtLean("/paper/Demo.lean", 3), undefined);

  const line5 = index.hitsForTex("/paper/demo.tex", 4);
  assert.deepEqual(
    line5.map((link) => link.leanLine),
    [1, 2],
  );
  const line6 = index.hitsForTex("/paper/demo.tex", 5);
  assert.deepEqual(
    line6.map((link) => link.leanLine),
    [1],
  );

  index.replaceLean("/paper/Demo.lean", []);
  assert.deepEqual(index.hitsForTex("/paper/demo.tex", 4), []);
});

test("finds a Lean line from a PDF point on the same band", () => {
  files.set("/paper/demo.pdf", "");
  const index = new LinkIndex();
  const text = 'theorem one : True := by -- @pdf: demo.pdf:1:10:20:30:8';
  index.replaceLean("/paper/Demo.lean", linksFromLeanText("/paper/Demo.lean", text, ["/paper"], resolver));
  assert.deepEqual(
    index.hitsForPdf("/paper/demo.pdf", 1, 80, 24).map((link) => link.leanLine),
    [0],
  );
  assert.deepEqual(index.hitsForPdf("/paper/demo.pdf", 1, 80, 80), []);
  index.replaceLean("/paper/Demo.lean", []);
  assert.deepEqual(index.hitsForPdf("/paper/demo.pdf", 1, 12, 22), []);
});
