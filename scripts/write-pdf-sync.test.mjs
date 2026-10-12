import assert from "node:assert/strict";
import test from "node:test";
import { boxFromSynctex, formatPdfComment, parseSynctexRecord, upsertPdfComment } from "./write-pdf-sync.mjs";

test("inserts a PDF marker and replaces an old one", () => {
  const once = upsertPdfComment("theorem one : True := by -- @tex: demo.tex:5", "@pdf: demo.pdf:1:1.00:2.00:3.00:4.00");
  assert.equal(once, "theorem one : True := by -- @tex: demo.tex:5 @pdf: demo.pdf:1:1.00:2.00:3.00:4.00");
  const twice = upsertPdfComment(once, "@pdf: demo.pdf:1:9.00:8.00:7.00:6.00");
  assert.equal(twice, "theorem one : True := by -- @tex: demo.tex:5 @pdf: demo.pdf:1:9.00:8.00:7.00:6.00");
});

test("turns a SyncTeX box into top-left coordinates", () => {
  const record = parseSynctexRecord(`SyncTeX result begin
Page:1
h:133.768356
v:136.701797
W:343.711060
H:8.855677
SyncTeX result end
`);
  const box = boxFromSynctex(record);
  assert.equal(box.page, 1);
  assert.equal(formatPdfComment("demo.pdf", box), "@pdf: demo.pdf:1:133.77:127.85:343.71:8.86");
});
