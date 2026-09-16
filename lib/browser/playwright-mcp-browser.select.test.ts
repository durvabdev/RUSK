import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSelectOption } from "./playwright-mcp-browser.ts";

test("resolves partial label to option value when balance is in label", () => {
  const options = [
    {
      index: 0,
      value: "CK-2010",
      label: "Checking CK-2010 ($34,258.07)",
      text: "Checking CK-2010 ($34,258.07)",
    },
    {
      index: 1,
      value: "SV-2010",
      label: "Savings SV-2010 ($29,975.00)",
      text: "Savings SV-2010 ($29,975.00)",
    },
  ];
  assert.deepEqual(resolveSelectOption(options, "Savings SV-2010"), {
    value: "SV-2010",
    strategy: "label-includes",
  });
  assert.deepEqual(resolveSelectOption(options, "SV-2010"), {
    value: "SV-2010",
    strategy: "exact-value",
  });
});
