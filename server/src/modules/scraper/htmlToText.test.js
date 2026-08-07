import { describe, expect, it } from "vitest";
import { extractHeading, extractTitle, htmlToText, parseJobPage } from "./htmlToText.js";

// `&nbsp;` decodes to this, and real job pages are full of them.
const NBSP = String.fromCharCode(160);

const PAGE = `
<html>
  <head><title>Senior Backend Engineer — Nova Systems</title></head>
  <body>
    <nav>Home Careers Contact</nav>
    <h1>Senior${NBSP}${NBSP}Backend Engineer</h1>
    <p>Build distributed services.</p>
    <p>Remote${NBSP}friendly.</p>
    <script>window.analytics = 1;</script>
    <style>.x { color: red }</style>
    <footer>Privacy policy</footer>
  </body>
</html>`;

describe("htmlToText", () => {
  it("drops the contents of noise blocks, not just their tags", () => {
    const text = htmlToText(PAGE);
    expect(text).not.toContain("window.analytics");
    expect(text).not.toContain("color: red");
    expect(text).not.toContain("Privacy policy");
    expect(text).not.toContain("Home Careers Contact");
  });

  it("keeps the real description", () => {
    expect(htmlToText(PAGE)).toContain("Build distributed services.");
  });

  it("inserts breaks at block edges so text doesn't run together", () => {
    const text = htmlToText("<p>Apply now</p><p>Requirements</p>");
    expect(text).toBe("Apply now\nRequirements");
  });

  it("collapses non-breaking spaces along with ordinary whitespace", () => {
    const text = htmlToText(`<p>Remote${NBSP}${NBSP}friendly</p>`);
    expect(text).toBe("Remote friendly");
    expect(text).not.toContain(NBSP);
  });

  it("decodes entities via sanitizeText", () => {
    expect(htmlToText("<p>R&amp;D &lt;team&gt;</p>")).toBe("R&D <team>");
  });

  it("caps length", () => {
    expect(htmlToText(`<p>${"x".repeat(500)}</p>`, 100)).toHaveLength(100);
  });

  it("handles null and undefined without throwing", () => {
    expect(htmlToText(null)).toBe("");
    expect(htmlToText(undefined)).toBe("");
  });
});

describe("extractTitle / extractHeading", () => {
  it("reads the title and h1", () => {
    expect(extractTitle(PAGE)).toBe("Senior Backend Engineer — Nova Systems");
    expect(extractHeading(PAGE)).toBe("Senior Backend Engineer");
  });

  it("returns empty strings when the elements are absent", () => {
    expect(extractTitle("<html><body>hi</body></html>")).toBe("");
    expect(extractHeading("<html><body>hi</body></html>")).toBe("");
  });

  it("collapses whitespace, since role/company are parsed out of these", () => {
    expect(extractHeading("<h1>Staff\n\n   Engineer</h1>")).toBe("Staff Engineer");
  });
});

describe("parseJobPage", () => {
  it("returns title, heading and text together", () => {
    const parsed = parseJobPage(PAGE);
    expect(parsed).toEqual({
      title: "Senior Backend Engineer — Nova Systems",
      heading: "Senior Backend Engineer",
      text: expect.stringContaining("Build distributed services."),
    });
  });
});
