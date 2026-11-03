import { describe, expect, it } from "vitest";
import { isValidElement } from "react";

import {
  renderTextWithLinks,
  renderTextWithMentionsAndLinks,
} from "./task-mentions";
import type { Member } from "../types/tasks";

const members: Member[] = [
  {
    id: "m-1",
    name: "Ana",
    email: "ana@example.com",
    role: "Dev",
    avatarColor: "bg-blue-500",
  },
];

describe("task-mentions link rendering", () => {
  it("returns null when text is only a hidden URL", () => {
    const result = renderTextWithLinks("https://example.com", "link-class", [
      "https://example.com",
    ]);

    expect(result).toBeNull();
  });

  it("returns null when hidden URL leaves only whitespace", () => {
    const result = renderTextWithLinks(
      "   https://example.com   ",
      "link-class",
      ["https://example.com"],
    );

    expect(result).toBeNull();
  });

  it("keeps non-link text when hiding URL", () => {
    const result = renderTextWithLinks(
      "ver aqui https://example.com",
      "link-class",
      ["https://example.com"],
    );

    expect(result).toEqual(["ver aqui "]);
  });

  it("returns null in mentions+links renderer when only hidden URL exists", () => {
    const result = renderTextWithMentionsAndLinks(
      "https://example.com",
      members,
      "mention-class",
      "link-class",
      ["https://example.com"],
    );

    expect(result).toBeNull();
  });

  it("preserves mention chips while hiding URLs", () => {
    const result = renderTextWithMentionsAndLinks(
      "@Ana https://example.com",
      members,
      "mention-class",
      "link-class",
      ["https://example.com"],
    );

    expect(Array.isArray(result)).toBe(true);
    expect(isValidElement((result as unknown[])[0])).toBe(true);
  });
});
