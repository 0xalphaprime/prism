import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clampLimits,
  cleanQueries,
  flagQueries,
  identifyingTerms,
  isPublicHttpUrl,
  normalizeUrl,
  overlapReport,
  parsePlan,
  runResearch,
  type ReadFn,
  type SearchFn,
} from "./research";

const limits = { searches: 3, pagesPerSearch: 2, pageChars: 50 };

function hits(...urls: string[]) {
  return urls.map((url) => ({ url, title: `Title ${url}`, description: "about" }));
}

describe("search plan parsing", () => {
  it("reads the asked-for JSON", () => {
    const plan = parsePlan('{"queries":[{"query":"churn after price rise","why":"base rate"}]}', 4);
    assert.deepEqual(plan, [{ query: "churn after price rise", why: "base rate" }]);
  });

  it("reads JSON inside a code fence with prose around it", () => {
    const text = 'Here is my plan:\n```json\n{"queries":[{"query":"a"},{"query":"b"}]}\n```\nDone.';
    assert.deepEqual(parsePlan(text, 4).map((q) => q.query), ["a", "b"]);
  });

  it("reads a bare list and a bulleted list", () => {
    assert.deepEqual(parsePlan('["one","two"]', 4).map((q) => q.query), ["one", "two"]);
    assert.deepEqual(parsePlan("- first thing\n2. second thing\nnot a query", 4).map((q) => q.query), [
      "first thing",
      "second thing",
    ]);
  });

  it("drops blanks and repeats and keeps to the limit", () => {
    const plan = cleanQueries(["a", " A ", "", "b", "c", "d"], 3);
    assert.deepEqual(plan.map((q) => q.query), ["a", "b", "c"]);
  });

  it("returns nothing for an empty plan or nonsense", () => {
    assert.deepEqual(parsePlan('{"queries":[]}', 4), []);
    assert.deepEqual(parsePlan("I do not need to search.", 4), []);
  });
});

describe("limits", () => {
  it("uses defaults and caps what is asked for", () => {
    assert.deepEqual(clampLimits(), { searches: 4, pagesPerSearch: 2, pageChars: 6000 });
    assert.deepEqual(clampLimits({ searches: 99, pagesPerSearch: 0, pageChars: 1 }), {
      searches: 8,
      pagesPerSearch: 1,
      pageChars: 500,
    });
  });
});

describe("web addresses", () => {
  it("allows public pages", () => {
    assert.equal(isPublicHttpUrl("https://example.com/a?b=1"), true);
    assert.equal(isPublicHttpUrl("http://8.8.8.8/x"), true);
  });

  it("refuses this machine, private networks and odd schemes", () => {
    for (const url of [
      "http://localhost:3001/api",
      "http://127.0.0.1/",
      "http://10.0.0.5/",
      "http://192.168.1.1/",
      "http://172.16.0.1/",
      "http://169.254.169.254/latest/meta-data",
      "http://100.78.81.94:11434/",
      "http://[::1]/",
      "http://intranet/",
      "http://db.internal/",
      "file:///etc/passwd",
      "ftp://example.com/",
      "https://user:pw@example.com/",
      "not a url",
    ]) {
      assert.equal(isPublicHttpUrl(url), false, url);
    }
  });

  it("gives the same page one spelling", () => {
    assert.equal(
      normalizeUrl("http://www.Example.com/report/?utm_source=x&b=2&a=1#top"),
      normalizeUrl("https://example.com/report?a=1&b=2"),
    );
  });
});

describe("names and figures from the material", () => {
  const material =
    "We sell to Northwind Traders and HubSpot agencies. Revenue was $412,000 last year. " +
    "The team met in March 2026. Pricing is the open question. pricing has not changed.";

  it("finds names, product names and figures", () => {
    const terms = identifyingTerms(material);
    for (const term of ["northwind", "traders", "hubspot", "412000"]) {
      assert.ok(terms.includes(term), `${term} in ${terms.join(",")}`);
    }
  });

  it("leaves ordinary words, months and years alone", () => {
    const terms = identifyingTerms(material);
    for (const term of ["pricing", "march", "2026", "revenue", "the"]) {
      assert.ok(!terms.includes(term), term);
    }
  });

  it("flags only the searches that repeat them", () => {
    const flagged = flagQueries(
      [
        { query: "typical churn after a price rise", why: "" },
        { query: "Northwind Traders reviews", why: "" },
        { query: "agency with $412,000 revenue benchmarks", why: "" },
      ],
      material,
    );
    assert.deepEqual(
      flagged.map((f) => f.query),
      ["Northwind Traders reviews", "agency with $412,000 revenue benchmarks"],
    );
    assert.deepEqual(flagged[0].terms.sort(), ["northwind", "traders"]);
  });
});

describe("running research", () => {
  it("records every search, result and page, and gives pages source ids", async () => {
    const search: SearchFn = async (query) => hits(`https://a.com/${query}/1`, `https://a.com/${query}/2`);
    const read: ReadFn = async (url) => ({ text: `text of ${url}`, via: "stub" });
    let tick = 100;
    const record = await runResearch({
      queries: [
        { query: "q1", why: "w1" },
        { query: "q2", why: "w2" },
      ],
      limits,
      search,
      read,
      now: () => (tick += 1),
    });
    assert.deepEqual(record.queries.map((q) => q.query), ["q1", "q2"]);
    assert.equal(record.queries[0].why, "w1");
    assert.deepEqual(record.pages.map((p) => p.id), ["S1", "S2", "S3", "S4"]);
    assert.equal(record.pages[2].query, "q2");
    assert.equal(record.pages[0].via, "stub");
    assert.ok(record.queries[0].startedAt < record.queries[0].finishedAt);
  });

  it("stops at the search limit and the pages-per-search limit", async () => {
    const searched: string[] = [];
    const readUrls: string[] = [];
    const search: SearchFn = async (query, opts) => {
      searched.push(query);
      assert.equal(opts.limit, limits.pagesPerSearch + 3);
      return hits(...[1, 2, 3, 4].map((n) => `https://a.com/${query}/${n}`));
    };
    const read: ReadFn = async (url) => {
      readUrls.push(url);
      return { text: "x", via: "stub" };
    };
    const record = await runResearch({
      queries: ["q1", "q2", "q3", "q4", "q5"].map((query) => ({ query, why: "" })),
      limits,
      search,
      read,
    });
    assert.deepEqual(searched, ["q1", "q2", "q3"]);
    assert.equal(readUrls.length, 6);
    assert.equal(record.queries[0].hits.filter((h) => h.read).length, 2);
    assert.equal(record.queries[0].hits[2].skipped, "Over the page limit");
  });

  it("cuts long pages at the character limit and says so", async () => {
    const record = await runResearch({
      queries: [{ query: "q", why: "" }],
      limits,
      search: async () => hits("https://a.com/long", "https://a.com/short"),
      read: async (url) => ({ text: url.endsWith("long") ? "y".repeat(500) : "short", via: "stub" }),
    });
    assert.equal(record.pages[0].chars, 50);
    assert.equal(record.pages[0].truncated, true);
    assert.equal(record.pages[1].truncated, false);
  });

  it("does not read the same page twice or leave the public web", async () => {
    const readUrls: string[] = [];
    const record = await runResearch({
      queries: [
        { query: "q1", why: "" },
        { query: "q2", why: "" },
      ],
      limits,
      search: async (query) =>
        query === "q1"
          ? hits("http://localhost:3001/secret", "https://a.com/same?utm_source=x")
          : hits("https://www.a.com/same", "https://a.com/other"),
      read: async (url) => {
        readUrls.push(url);
        return { text: "x", via: "stub" };
      },
    });
    assert.deepEqual(readUrls, ["https://a.com/same?utm_source=x", "https://a.com/other"]);
    assert.equal(record.queries[0].hits[0].skipped, "Not a public web address");
    assert.equal(record.queries[1].hits[0].skipped, "Already read for an earlier search");
  });

  it("keeps going when a search or a page fails, and records the failure", async () => {
    const record = await runResearch({
      queries: [
        { query: "bad", why: "" },
        { query: "good", why: "" },
      ],
      limits,
      search: async (query) => {
        if (query === "bad") throw new Error("search down");
        return hits("https://a.com/broken", "https://a.com/fine");
      },
      read: async (url) => {
        if (url.endsWith("broken")) throw new Error("404");
        return { text: "fine", via: "stub" };
      },
    });
    assert.equal(record.queries[0].error, "search down");
    assert.equal(record.pages[0].error, "404");
    assert.equal(record.pages[1].text, "fine");
  });
});

describe("overlap between members", () => {
  it("counts sources two members both pulled", () => {
    const report = overlapReport([
      { slug: "a", pages: [{ url: "https://x.com/1", title: "One" }, { url: "https://x.com/2", title: "Two" }] },
      { slug: "b", pages: [{ url: "http://www.x.com/1/", title: "One" }, { url: "https://x.com/3", title: "Three" }] },
      { slug: "c", pages: [{ url: "https://x.com/4", title: "Four" }] },
    ]);
    assert.equal(report.distinct, 4);
    assert.equal(report.shared.length, 1);
    assert.deepEqual(report.shared[0].members, ["a", "b"]);
    assert.equal(report.figure, 0.25);
    assert.deepEqual(report.pairs, [
      { a: "a", b: "b", shared: 1 },
      { a: "a", b: "c", shared: 0 },
      { a: "b", b: "c", shared: 0 },
    ]);
  });

  it("is zero when nothing was read", () => {
    assert.equal(overlapReport([{ slug: "a", pages: [] }]).figure, 0);
  });
});
