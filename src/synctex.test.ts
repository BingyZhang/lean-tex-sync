import assert from "node:assert/strict";
import test from "node:test";
import { parseSynctexEdit, parseSynctexView } from "./synctex";

const view = `This is SyncTeX command line utility, version 1.5
SyncTeX result begin
Output:probe.pdf
Page:1
x:175.002686
y:134.764618
h:133.768356
v:136.701797
W:343.711060
H:8.855677
before:
offset:-1
middle:
after:
SyncTeX result end
`;

test("parses a forward SyncTeX record", () => {
  const hit = parseSynctexView(view);
  assert.equal(hit?.page, 1);
  assert.equal(hit?.x, 175.002686);
  assert.equal(hit?.y, 134.764618);
  assert.equal(hit?.h, 133.768356);
  assert.equal(hit?.width, 343.711060);
  assert.equal(hit?.height, 8.855677);
});

test("parses a reverse SyncTeX record", () => {
  const hit = parseSynctexEdit(`SyncTeX result begin
Output:probe.pdf
Input:/private/tmp/synctex-probe/./probe.tex
Line:3
Column:-1
Offset:0
Context:
SyncTeX result end
`);
  assert.deepEqual(hit, { input: "/private/tmp/synctex-probe/./probe.tex", line: 3 });
});

test("ignores output that is not a SyncTeX record", () => {
  assert.equal(parseSynctexView("synctex: command not found"), undefined);
  assert.equal(parseSynctexEdit("SyncTeX result begin\nLine:0\nSyncTeX result end"), undefined);
});
