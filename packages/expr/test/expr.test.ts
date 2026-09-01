import { describe, expect, it } from "vitest";
import {
  AST_LIMITS, FUNCTIONS, FUNCTION_NAMES, ExprSyntaxError,
  analyzeExpression, analyzeModel, applyWindow, evalAggregate, evalPostColumn,
  parse, quoteIdent, sqlLiteral, toSql, tokenize, truncateDate,
  type Row, type Value,
} from "@gridwright/expr";

const sqlCtx = {
  field: (n: string) => `"${n}"`,
  measure: (id: string) => `m_${id}`,
};

const sql = (src: string) => toSql(parse(src), sqlCtx);

describe("tokenizer", () => {
  it("handles numbers in every accepted spelling", () => {
    for (const src of ["1", "1.5", ".5", "1e6", "1.2e-3", "1E+2"]) {
      const t = tokenize(src);
      expect(t[0]!.type, src).toBe("number");
      expect(Number(t[0]!.value), src).toBe(Number(src));
    }
  });

  it("normalises operator spellings", () => {
    expect(tokenize("a == b")[1]!.value).toBe("=");
    expect(tokenize("a <> b")[1]!.value).toBe("!=");
  });

  it("reads escapes inside strings", () => {
    expect(tokenize(String.raw`"a\"b"`)[0]!.value).toBe('a"b');
    expect(tokenize(String.raw`'a\nb'`)[0]!.value).toBe("a\nb");
  });

  it("rejects an unterminated string", () => {
    expect(() => tokenize('"oops')).toThrow(ExprSyntaxError);
  });

  it("rejects characters outside the grammar", () => {
    for (const src of ["a @ b", "a # b", "a; b", "a[0]", "a`b`"]) {
      expect(() => tokenize(src), src).toThrow(ExprSyntaxError);
    }
  });
});

describe("parser", () => {
  it("respects operator precedence", () => {
    // Multiplication binds tighter, so it becomes the right operand of `+`.
    expect(parse("1 + 2 * 3")).toMatchObject({
      kind: "binary", op: "+",
      left: { kind: "number", value: 1 },
      right: { kind: "binary", op: "*" },
    });
    expect(parse("(1 + 2) * 3")).toMatchObject({
      kind: "binary", op: "*",
      left: { kind: "binary", op: "+" },
    });
    // `and` binds looser than a comparison.
    expect(parse("a = 1 and b = 2")).toMatchObject({
      kind: "binary", op: "and",
      left: { kind: "binary", op: "=" },
      right: { kind: "binary", op: "=" },
    });
    // Subtraction is left-associative: (10 - 3) - 2, not 10 - (3 - 2).
    expect(parse("10 - 3 - 2")).toMatchObject({
      kind: "binary", op: "-",
      left: { kind: "binary", op: "-" },
      right: { kind: "number", value: 2 },
    });
  });

  it("parses and/or/not as keywords", () => {
    const a = analyzeExpression("countIf(not returned and amount > 10)");
    expect(a.issues).toEqual([]);
  });

  it("treats a bare identifier as a field", () => {
    const n = parse("amount");
    expect(n).toEqual({ kind: "field", name: "amount", pos: 0 });
  });

  it("parses measure() into its own node kind", () => {
    const n = parse("measure(revenue)");
    expect(n).toEqual({ kind: "measure", id: "revenue", pos: 0 });
  });

  it("rejects measure() with a non-identifier argument", () => {
    for (const src of ["measure(1)", "measure()", "measure(a, b)", 'measure("x")']) {
      expect(() => parse(src), src).toThrow(/measure\(\) takes exactly one/);
    }
  });

  it("rejects trailing input", () => {
    expect(() => parse("1 + 2 3")).toThrow(/trailing/);
  });

  it("rejects a keyword used as a name", () => {
    expect(() => parse("sum(and)")).toThrow(/keyword/);
  });

  it("enforces the AST depth ceiling", () => {
    const deep = "abs(".repeat(AST_LIMITS.maxDepth + 2) + "1" + ")".repeat(AST_LIMITS.maxDepth + 2);
    expect(() => parse(deep)).toThrow(/nests/);
  });

  it("enforces the node ceiling", () => {
    // A flat argument list grows node count without growing depth.
    const wide = "coalesce(" + Array.from({ length: 8 }, () =>
      "coalesce(" + Array.from({ length: 8 }, () =>
        "coalesce(" + Array.from({ length: 8 }, (_, k) => k).join(", ") + ")").join(", ") + ")").join(", ") + ")";
    expect(() => parse(wide)).toThrow(/nodes/);
  });

  it("bounds parser recursion before the stack can blow", () => {
    // Parenthesised groups collapse to their inner node, so the AST depth check
    // never sees these — only the parse-time guard stops them.
    const nested = "(".repeat(50_000) + "1" + ")".repeat(50_000);
    expect(() => parse(nested)).toThrow(/nests deeper than/);
  });

  it("rejects names that collide with object internals", () => {
    for (const src of ["__proto__", "sum(__proto__)", "measure(__proto__)", "constructor", "prototype"]) {
      expect(() => parse(src), src).toThrow(/reserved name/);
    }
  });

  it("has no member-access node in the grammar", () => {
    // The sandbox rests on this: an expression cannot name a host property.
    for (const src of ["a.b", "constructor.name", "a['b']", "this.x"]) {
      expect(() => parse(src), src).toThrow();
    }
  });
});

describe("stage analysis", () => {
  it("classifies a raw aggregate as the aggregate tier", () => {
    const { analysis } = analyzeExpression("sum(amount)");
    expect(analysis!.stage).toBe("aggregate");
    expect(analysis!.fields).toEqual(["amount"]);
  });

  it("classifies measure composition as the post tier", () => {
    const { analysis } = analyzeExpression("measure(a) / measure(b)");
    expect(analysis!.stage).toBe("post");
    expect(analysis!.measures.sort()).toEqual(["a", "b"]);
  });

  it("rejects a bare field outside an aggregate", () => {
    const { issues } = analyzeExpression("amount * 2");
    expect(issues[0]!.message).toMatch(/must sit inside an aggregate/);
  });

  it("rejects nested aggregates", () => {
    expect(analyzeExpression("sum(sum(amount))").issues[0]!.message).toMatch(/nested inside another aggregate/);
  });

  it("rejects mixing raw aggregates with measure()", () => {
    expect(analyzeExpression("sum(amount) / measure(orders)").issues.some((i) =>
      /cannot mix raw aggregates/.test(i.message))).toBe(true);
  });

  it("rejects an aggregate inside a window and suggests the fix", () => {
    expect(analyzeExpression("runningSum(sum(amount))").issues[0]!.message)
      .toMatch(/define it as its own measure/);
  });

  it("rejects nested window functions", () => {
    expect(analyzeExpression("lag(runningSum(measure(a)), 1)").issues[0]!.message)
      .toMatch(/nested inside another window/);
  });

  it("rejects unknown functions and suggests a near match", () => {
    expect(analyzeExpression("summ(amount)").issues[0]!.message).toMatch(/did you mean sum\(\)/);
    expect(analyzeExpression("SUM(amount)").issues[0]!.message).toMatch(/did you mean sum\(\)/);
  });

  it("checks arity", () => {
    expect(analyzeExpression("round(1, 2, 3)").issues[0]!.message).toMatch(/takes 1–2 argument/);
    expect(analyzeExpression("if(1, 2)").issues[0]!.message).toMatch(/takes 3 argument/);
  });

  it("accepts scalars nested inside an aggregate", () => {
    expect(analyzeExpression("sum(if(returned, 0, amount))").issues).toEqual([]);
  });
});

describe("model analysis", () => {
  it("orders dependencies before dependents", () => {
    const r = analyzeModel([
      { id: "aov", expr: "measure(revenue) / measure(orders)" },
      { id: "revenue", expr: "sum(amount)" },
      { id: "orders", expr: "count()" },
    ]);
    expect(r.issues).toEqual([]);
    expect(r.order.indexOf("aov")).toBeGreaterThan(r.order.indexOf("revenue"));
    expect(r.order.indexOf("aov")).toBeGreaterThan(r.order.indexOf("orders"));
  });

  it("detects a direct cycle", () => {
    const r = analyzeModel([
      { id: "a", expr: "measure(b) + 1" },
      { id: "b", expr: "measure(a) + 1" },
    ]);
    expect(r.issues.some((i) => /circular measure reference/.test(i.message))).toBe(true);
  });

  it("detects an indirect cycle", () => {
    const r = analyzeModel([
      { id: "a", expr: "measure(b)" },
      { id: "b", expr: "measure(c)" },
      { id: "c", expr: "measure(a)" },
    ]);
    expect(r.issues.some((i) => /circular/.test(i.message))).toBe(true);
  });

  it("detects self-reference", () => {
    const r = analyzeModel([{ id: "a", expr: "measure(a) + 1" }]);
    expect(r.issues.some((i) => /references itself/.test(i.message))).toBe(true);
  });

  it("reports an unknown measure reference", () => {
    const r = analyzeModel([{ id: "a", expr: "measure(ghost)" }]);
    expect(r.issues.some((i) => /unknown measure "ghost"/.test(i.message))).toBe(true);
  });
});

describe("sql emitter", () => {
  it("guards division against a zero denominator", () => {
    expect(sql("measure(a) / measure(b)")).toContain("nullif((m_b), 0)");
  });

  it("escapes string literals", () => {
    expect(sqlLiteral("O'Brien")).toBe("'O''Brien'");
    expect(sqlLiteral(null)).toBe("NULL");
    expect(sqlLiteral(true)).toBe("TRUE");
  });

  it("refuses to emit an unsafe identifier", () => {
    expect(() => quoteIdent('a"; drop table t; --')).toThrow(/unsafe SQL identifier/);
    expect(quoteIdent("order_date")).toBe('"order_date"');
  });

  it("emits SQL for every function in the catalogue", () => {
    for (const name of FUNCTION_NAMES) {
      const spec = FUNCTIONS[name]!;
      const args = Array.from({ length: Math.max(spec.minArgs, 1) }, () => "X");
      expect(spec.sql(args), name).toBeTypeOf("string");
      expect(spec.sql(args).length, name).toBeGreaterThan(0);
    }
  });

  it("never lets a literal escape quoting", () => {
    const evil = "'; DROP TABLE sales; --";
    expect(sql(`countIf(region = ${JSON.stringify(evil)})`)).toContain("''; DROP TABLE sales; --'");
  });
});

const rows: Row[] = [
  { amount: 10, returned: false, region: "N" },
  { amount: 20, returned: true, region: "S" },
  { amount: 30, returned: false, region: "N" },
  { amount: null, returned: false, region: "S" },
];

const agg = (src: string) => evalAggregate(parse(src), rows);

describe("aggregate evaluation", () => {
  it("covers every aggregate in the catalogue", () => {
    expect(agg("sum(amount)")).toBe(60);
    expect(agg("count()")).toBe(4);
    expect(agg("count(amount)")).toBe(3);
    expect(agg("countDistinct(region)")).toBe(2);
    expect(agg("countIf(returned)")).toBe(1);
    expect(agg("avg(amount)")).toBe(20);
    expect(agg("min(amount)")).toBe(10);
    expect(agg("max(amount)")).toBe(30);
    expect(agg("median(amount)")).toBe(20);
  });

  it("ignores nulls rather than poisoning the total", () => {
    expect(evalAggregate(parse("sum(amount)"), [{ amount: null }])).toBeNull();
    expect(evalAggregate(parse("avg(amount)"), [{ amount: null }])).toBeNull();
  });

  it("evaluates scalars row-wise inside an aggregate", () => {
    expect(agg("sum(if(returned, 0, amount))")).toBe(40);
  });

  it("returns null for division by zero instead of Infinity", () => {
    expect(agg("sum(amount) / countIf(false)")).toBeNull();
  });

  it("composes arithmetic over aggregates", () => {
    expect(agg("sum(amount) / count(amount)")).toBe(20);
    expect(agg("round(sum(amount) / count(amount), 1)")).toBe(20);
  });
});

describe("post-aggregation evaluation", () => {
  const columns: Record<string, Value[]> = {
    revenue: [100, 200, 300, 400],
    orders: [2, 4, 5, 0],
  };
  const ctx = { rowCount: 4, column: (id: string) => columns[id]! };
  const post = (src: string) => evalPostColumn(parse(src), ctx);

  it("composes measures", () => {
    expect(post("measure(revenue) / measure(orders)")).toEqual([50, 50, 60, null]);
  });

  it("covers every window function", () => {
    expect(post("lag(measure(revenue), 1)")).toEqual([null, 100, 200, 300]);
    expect(post("lead(measure(revenue), 1)")).toEqual([200, 300, 400, null]);
    expect(post("runningSum(measure(revenue))")).toEqual([100, 300, 600, 1000]);
    expect(post("rank(measure(revenue))")).toEqual([4, 3, 2, 1]);
    expect(post("pctOfTotal(measure(revenue))")).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it("defaults lag/lead offset to 1", () => {
    expect(post("lag(measure(revenue))")).toEqual(post("lag(measure(revenue), 1)"));
  });

  it("computes a period-over-period change", () => {
    const r = post("measure(revenue) / lag(measure(revenue), 1) - 1") as (number | null)[];
    expect(r[0]).toBeNull();
    expect(r[1]).toBeCloseTo(1);
    expect(r[2]).toBeCloseTo(0.5);
  });

  it("handles an empty column without dividing by zero", () => {
    const empty = { rowCount: 0, column: () => [] };
    expect(evalPostColumn(parse("pctOfTotal(measure(x))"), empty)).toEqual([]);
  });
});

describe("date bucketing", () => {
  it("truncates to each supported grain", () => {
    expect(truncateDate("2024-03-15", "year")).toBe("2024-01-01");
    expect(truncateDate("2024-03-15", "quarter")).toBe("2024-01-01");
    expect(truncateDate("2024-05-15", "quarter")).toBe("2024-04-01");
    expect(truncateDate("2024-03-15", "month")).toBe("2024-03-01");
    expect(truncateDate("2024-03-15", "day")).toBe("2024-03-15");
  });

  it("starts weeks on Monday", () => {
    // 2024-03-15 is a Friday.
    expect(truncateDate("2024-03-15", "week")).toBe("2024-03-11");
    expect(truncateDate("2024-03-11", "week")).toBe("2024-03-11");
  });

  it("returns null for unparseable input rather than throwing", () => {
    expect(truncateDate("not a date", "month")).toBeNull();
  });
});

describe("window helpers", () => {
  it("ranks ties densely", () => {
    expect(applyWindow("rank", [10, 10, 5], 1)).toEqual([1, 1, 2]);
  });

  it("carries nulls through pctOfTotal", () => {
    expect(applyWindow("pctOfTotal", [null, 5, 5], 1)).toEqual([null, 0.5, 0.5]);
  });
});

describe("sandbox fuzz", () => {
  // Random byte soup must always produce a typed error, never an unhandled
  // throw and never a value — the parser is the only route text can take.
  const alphabet = `abc_ 019+-*/%()<>=!,'"\\.[]{}$@#;:&|^~\``.split("");
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

  it("never throws an untyped error over 3000 random inputs", () => {
    let parsed = 0;
    for (let i = 0; i < 3000; i++) {
      const len = 1 + Math.floor(rnd() * 24);
      const src = Array.from({ length: len }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join("");
      try {
        parse(src);
        parsed++;
      } catch (err) {
        expect(err, src).toBeInstanceOf(ExprSyntaxError);
      }
    }
    // Sanity: the corpus should not be so hostile that nothing ever parses.
    expect(parsed).toBeGreaterThan(0);
  });

  it("turns every hostile input into issues rather than an exception", () => {
    const hostile = [
      "constructor", "__proto__", "process.exit(1)", "require('fs')",
      "globalThis", "a=>1", "`${x}`", "function(){}", "new Date()",
      "1;2", "eval('x')", "import('x')", "measure(__proto__)",
    ];
    for (const src of hostile) {
      const r = analyzeExpression(src);
      expect(r.analysis, src).toBeUndefined();
      expect(r.issues.length, src).toBeGreaterThan(0);
    }
  });

  it("reports a character position for syntax errors", () => {
    const r = analyzeExpression("sum(amount");
    expect(r.issues[0]!.message).toMatch(/at character \d+/);
  });
});
