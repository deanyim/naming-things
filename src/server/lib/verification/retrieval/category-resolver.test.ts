import { describe, expect, it } from "vitest";
import { resolveCategorySpec } from "./category-resolver";

describe("resolveCategorySpec", () => {
  it("treats NFL quarterbacks as a buildable person dataset", () => {
    expect(resolveCategorySpec("nfl quarterbacks")).toMatchObject({
      id: "nfl-quarterbacks",
      buildable: true,
      entityType: "person",
    });
  });

  it("recognizes sports position categories as person datasets", () => {
    expect(resolveCategorySpec("baseball pitchers")).toMatchObject({
      buildable: true,
      entityType: "person",
    });
  });

  it("keeps current closed-set sports categories buildable", () => {
    expect(resolveCategorySpec("current nfl quarterbacks")).toMatchObject({
      buildable: true,
      entityType: "person",
      freshness: "daily",
    });
  });

  it("recognizes administration cabinet members as a person dataset", () => {
    expect(resolveCategorySpec("trump administration cabinet members")).toMatchObject({
      buildable: true,
      entityType: "person",
    });
  });

  it("marks subjective categories not buildable", () => {
    expect(resolveCategorySpec("best survivor contestants")).toMatchObject({
      buildable: false,
      entityType: "other",
    });
  });
});
