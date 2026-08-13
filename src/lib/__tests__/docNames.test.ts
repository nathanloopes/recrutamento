import { describe, it, expect } from "vitest";
import { toDocName, toDocNames } from "../docNames";

describe("toDocName", () => {
  it("returns plain string", () => {
    expect(toDocName("RG")).toBe("RG");
  });
  it("extracts name from DocMeta", () => {
    expect(
      toDocName({ name: "CPF", format: "pdf", required: true } as any)
    ).toBe("CPF");
  });
  it("handles null/undefined/missing name", () => {
    expect(toDocName(null)).toBe("");
    expect(toDocName(undefined)).toBe("");
    expect(toDocName({} as any)).toBe("");
  });
});

describe("toDocNames", () => {
  it("normalizes mixed array", () => {
    expect(
      toDocNames(["RG", { name: "CPF", required: true }, { foo: "bar" }, ""])
    ).toEqual(["RG", "CPF"]);
  });
  it("returns [] for non-array", () => {
    expect(toDocNames(null)).toEqual([]);
    expect(toDocNames(undefined)).toEqual([]);
    expect(toDocNames("RG" as any)).toEqual([]);
  });
});
