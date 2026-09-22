import { describe, expect, it } from "vitest";
import { formatYamlScalar, toYaml } from "./yaml";

describe("formatYamlScalar", () => {
  it("quotes strings containing a colon-space so they don't break YAML parsing", () => {
    expect(formatYamlScalar("a: b")).toBe(JSON.stringify("a: b"));
  });

  it("leaves plain strings unquoted", () => {
    expect(formatYamlScalar("hello")).toBe("hello");
  });

  it("renders null/undefined as the YAML null literal", () => {
    expect(formatYamlScalar(null)).toBe("null");
    expect(formatYamlScalar(undefined)).toBe("null");
  });

  it("renders numbers and booleans without quotes", () => {
    expect(formatYamlScalar(42)).toBe("42");
    expect(formatYamlScalar(true)).toBe("true");
  });
});

describe("toYaml", () => {
  it("converts a flat object to key: value lines", () => {
    expect(toYaml({ name: "theme", version: 2 })).toBe("name: theme\nversion: 2");
  });

  it("quotes a value that would otherwise corrupt the YAML grammar", () => {
    expect(toYaml({ note: "a: b" })).toBe(`note: ${JSON.stringify("a: b")}`);
  });

  it("renders arrays as dashed list items", () => {
    expect(toYaml(["#111827", "#60a5fa"])).toBe('- "#111827"\n- "#60a5fa"');
  });

  it("renders empty arrays and objects using flow style", () => {
    expect(toYaml([])).toBe("[]");
    expect(toYaml({})).toBe("{}");
  });
});
