import { describe, it, expect } from "vitest";
import { formatDateBR, ymdToLocalDate, dateToLocalYMD } from "../dateUtils";

describe("dateUtils — D-1 timezone safety", () => {
  it("formats YYYY-MM-DD without shifting day", () => {
    expect(formatDateBR("2003-01-02")).toBe("02/01/2003");
    expect(formatDateBR("2000-05-23")).toBe("23/05/2000");
    expect(formatDateBR("1980-06-22")).toBe("22/06/1980");
  });

  it("accepts ISO timestamps and returns just the date part as DD/MM/YYYY", () => {
    expect(formatDateBR("2000-05-23T00:00:00.000Z")).toBe("23/05/2000");
  });

  it("returns empty for null/empty/invalid", () => {
    expect(formatDateBR(null)).toBe("");
    expect(formatDateBR(undefined)).toBe("");
    expect(formatDateBR("")).toBe("");
    expect(formatDateBR("not-a-date")).toBe("");
  });

  it("round-trips ymd <-> Date without changing the day", () => {
    const cases = ["2000-05-23", "2003-01-02", "1980-06-22", "2024-02-29", "1999-12-31"];
    for (const ymd of cases) {
      const d = ymdToLocalDate(ymd)!;
      expect(d).not.toBeNull();
      expect(dateToLocalYMD(d)).toBe(ymd);
      expect(formatDateBR(dateToLocalYMD(d))).toBe(
        `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`
      );
    }
  });

  it("ymdToLocalDate anchors at noon to avoid DST/UTC shift", () => {
    const d = ymdToLocalDate("2000-05-23")!;
    expect(d.getFullYear()).toBe(2000);
    expect(d.getMonth()).toBe(4); // May
    expect(d.getDate()).toBe(23);
    expect(d.getHours()).toBe(12);
  });

  it("dateToLocalYMD never uses UTC so day matches local calendar", () => {
    // 23/05/2000 at 23:30 local — naive toISOString could roll to 24th in some TZs
    const d = new Date(2000, 4, 23, 23, 30, 0);
    expect(dateToLocalYMD(d)).toBe("2000-05-23");
  });
});
