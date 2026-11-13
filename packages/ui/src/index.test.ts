import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Input,
  Table,
  id,
} from "./index";

describe("@shipyard/ui", () => {
  it("exports the shared primitives", () => {
    expect(id).toBe("@shipyard/ui");
    expect(typeof Button).toBe("function");
    expect(typeof Card).toBe("function");
    expect(typeof Input).toBe("function");
    expect(typeof Dialog).toBe("function");
    expect(typeof Table).toBe("function");
    expect(typeof Badge).toBe("function");
    expect(typeof EmptyState).toBe("function");
  });

  it("renders the shared primitives with semantic markup", () => {
    const markup = renderToStaticMarkup(
      createElement(
        "section",
        undefined,
        createElement(Button, undefined, "Deploy"),
        createElement(Card, undefined, "Shared surface"),
        createElement(Input, { defaultValue: "shipyard-demo" }),
        createElement(Badge, { tone: "success" }, "LIVE"),
        createElement(EmptyState, {
          description: "Add a project to get started.",
          title: "Nothing deployed yet",
        }),
        createElement(Table, {
          caption: "Projects",
          columns: ["Name", "Runtime"],
          rows: [["marketing-site", "STATIC"]],
        }),
        createElement(
          Dialog,
          {
            description: "Shared modal framing for operator actions.",
            open: true,
            title: "Deploy preview",
          },
          createElement("p", undefined, "Immutable release flow"),
        ),
      ),
    );

    expect(markup).toContain("<button");
    expect(markup).toContain("Shared surface");
    expect(markup).toContain('value="shipyard-demo"');
    expect(markup).toContain("LIVE");
    expect(markup).toContain("Nothing deployed yet");
    expect(markup).toContain("<table");
    expect(markup).toContain('role="dialog"');
  });
});
