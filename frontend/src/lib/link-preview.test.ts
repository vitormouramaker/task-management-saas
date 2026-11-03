import { describe, expect, it } from "vitest";

import {
  extractManagedLinksFromText,
  getLinkPreviewMeta,
  getManagedLinkUrls,
  stripLinkUrlsFromText,
} from "./link-preview";

describe("link-preview managed link helpers", () => {
  it("removes a standalone URL line completely", () => {
    expect(stripLinkUrlsFromText("https://manus.im")).toBe("");
  });

  it("removes URL-only lines without leaving blank space", () => {
    expect(stripLinkUrlsFromText("Texto\nhttps://manus.im\nFim")).toBe(
      "Texto\nFim",
    );
  });

  it("collects URLs from both text and link display modes", () => {
    expect(
      getManagedLinkUrls("", {
        "https://manus.im": "preview",
      }),
    ).toEqual(["https://manus.im"]);
  });

  it("extracts links from text into link display modes", () => {
    expect(extractManagedLinksFromText("https://manus.im", {})).toEqual({
      text: "",
      urls: ["https://manus.im"],
      linkDisplayModes: {
        "https://manus.im": "preview",
      },
    });
  });

  it("returns brand metadata and favicon candidates for known domains", () => {
    expect(
      getLinkPreviewMeta("https://github.com/exemplo/projeto"),
    ).toMatchObject({
      hostnameLabel: "github.com",
      brandColor: "#24292f",
      brandSurfaceColor: "#e5e7eb",
    });

    expect(
      getLinkPreviewMeta("https://github.com/exemplo/projeto")?.faviconUrls,
    ).toContain("https://github.com/favicon.ico");
  });

  it("builds deterministic fallback brand metadata for unknown domains", () => {
    const preview = getLinkPreviewMeta("https://manus.im/produtos");

    expect(preview).toBeTruthy();
    expect(preview?.faviconUrls.length).toBeGreaterThan(0);
    expect(preview?.brandColor).toMatch(/^#/);
    expect(preview?.brandSurfaceColor).toMatch(/^#/);
  });
});
