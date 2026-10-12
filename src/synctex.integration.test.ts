import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { synctexEdit, synctexView } from "./synctex";

const binary = fs.existsSync("/Library/TeX/texbin/synctex") ? "/Library/TeX/texbin/synctex" : "synctex";
const root = path.resolve(__dirname, "..", "examples");
const pdf = path.join(root, "demo.pdf");
const tex = path.join(root, "demo.tex");

test("SyncTeX round-trips a TeX line through the PDF point", async (t) => {
  if (!fs.existsSync(pdf)) {
    t.skip("examples/demo.pdf is not built");
    return;
  }
  const forward = await synctexView(binary, pdf, tex, 5);
  assert.ok(forward.value, forward.output);
  const back = await synctexEdit(binary, pdf, forward.value.page, forward.value.x, forward.value.y);
  assert.equal(back.value?.line, 5, back.output);
});
