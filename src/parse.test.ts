import assert from "node:assert/strict";
import test from "node:test";
import { parsePdfRef, parseTexRef } from "./parse";

test("parses an end-of-line marker", () => {
  const ref = parseTexRef("  trivial -- @tex: demo.tex:5");
  assert.deepEqual(ref, { rawPath: "demo.tex", startLine: 5, endLine: 5 });
});

test("parses a line range and a directory", () => {
  const ref = parseTexRef("-- @tex: Snarky_STMS/5-security.tex:88-96");
  assert.deepEqual(ref, {
    rawPath: "Snarky_STMS/5-security.tex",
    startLine: 88,
    endLine: 96,
  });
});

test("parses a quoted path", () => {
  const ref = parseTexRef("sorry /- @tex: \"my file.tex\":12 -/");
  assert.deepEqual(ref, { rawPath: "my file.tex", startLine: 12, endLine: 12 });
});

test("parses a PDF rectangle on the same line as a TeX marker", () => {
  const line = "theorem one : True := by -- @tex: demo.tex:5 @pdf: demo.pdf:1:133.77:127.85:343.71:8.86";
  assert.deepEqual(parsePdfRef(line), {
    rawPath: "demo.pdf",
    page: 1,
    left: 133.77,
    top: 127.85,
    width: 343.71,
    height: 8.86,
  });
  assert.equal(parseTexRef(line)?.startLine, 5);
});

test("rejects a reversed range and a line without a marker", () => {
  assert.equal(parseTexRef("-- @tex: demo.tex:8-3"), undefined);
  assert.equal(parseTexRef("theorem foo : True := trivial"), undefined);
  assert.equal(parseTexRef("-- @tex: demo.tex:0"), undefined);
});
