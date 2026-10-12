import assert from "node:assert/strict";
import test from "node:test";
import { boxFromSynctexPoint, formatPdfComment, upsertPdfComment } from "./pdfComment";

test("replaces an existing PDF marker", () => {
  const line = "theorem one : True := by -- @tex: demo.tex:5 @pdf: demo.pdf:1:1.00:2.00:3.00:4.00";
  assert.equal(
    upsertPdfComment(line, "@pdf: demo.pdf:1:9.00:8.00:7.00:6.00"),
    "theorem one : True := by -- @tex: demo.tex:5 @pdf: demo.pdf:1:9.00:8.00:7.00:6.00",
  );
});

test("formats the SyncTeX box from the top-left corner", () => {
  const box = boxFromSynctexPoint({ page: 1, h: 133.768, v: 136.702, width: 343.711, height: 8.856 });
  assert.ok(box);
  assert.equal(formatPdfComment("demo.pdf", box), "@pdf: demo.pdf:1:133.77:127.85:343.71:8.86");
});
