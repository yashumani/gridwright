import { AST_LIMITS, countNodes, depth, type BinaryOp, type Node, type UnaryOp } from "./ast.js";
import { ExprSyntaxError, tokenize, type Token } from "./tokenize.js";
import { MEASURE_REF } from "./functions.js";
import { isReservedName } from "@gridwright/schema";

/**
 * A Pratt parser. Every path from source text to a runnable expression goes
 * through here — there is no `eval`, no `Function`, and no member-access node
 * in the grammar, so an expression cannot reach the host at all.
 */

const BINARY_PRECEDENCE: Record<string, number> = {
  or: 1,
  and: 2,
  "=": 3, "!=": 3, "<": 3, "<=": 3, ">": 3, ">=": 3,
  "+": 4, "-": 4,
  "*": 5, "/": 5, "%": 5,
};

const KEYWORDS = new Set(["and", "or", "not", "true", "false", "null"]);

class Parser {
  private i = 0;
  private depth = 0;
  constructor(private readonly tokens: Token[]) {}

  private enter(pos: number): void {
    if (++this.depth > AST_LIMITS.maxParseDepth) {
      throw new ExprSyntaxError(
        `expression nests deeper than ${AST_LIMITS.maxParseDepth} levels`, pos,
      );
    }
  }

  private leave(): void {
    this.depth--;
  }

  private peek(): Token {
    return this.tokens[this.i]!;
  }

  private next(): Token {
    return this.tokens[this.i++]!;
  }

  private expect(type: Token["type"], what: string): Token {
    const t = this.peek();
    if (t.type !== type) {
      throw new ExprSyntaxError(`expected ${what} but found ${t.value || "end of expression"}`, t.pos);
    }
    return this.next();
  }

  /** Binary operator at the current position, or undefined. */
  private binaryOp(): { op: BinaryOp; prec: number } | undefined {
    const t = this.peek();
    if (t.type === "op" && t.value in BINARY_PRECEDENCE) {
      return { op: t.value as BinaryOp, prec: BINARY_PRECEDENCE[t.value]! };
    }
    if (t.type === "ident" && (t.value === "and" || t.value === "or")) {
      return { op: t.value as BinaryOp, prec: BINARY_PRECEDENCE[t.value]! };
    }
    return undefined;
  }

  parseExpression(minPrec = 0): Node {
    this.enter(this.peek().pos);
    try {
      let left = this.parseUnary();
      for (;;) {
        const bin = this.binaryOp();
        if (!bin || bin.prec < minPrec) break;
        this.next();
        const right = this.parseExpression(bin.prec + 1);
        left = { kind: "binary", op: bin.op, left, right };
      }
      return left;
    } finally {
      this.leave();
    }
  }

  private parseUnary(): Node {
    const t = this.peek();
    if (t.type === "op" && t.value === "-") {
      this.next();
      return { kind: "unary", op: "-" as UnaryOp, operand: this.parseUnary() };
    }
    if (t.type === "ident" && t.value === "not") {
      this.next();
      return { kind: "unary", op: "not" as UnaryOp, operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    const t = this.next();

    if (t.type === "number") return { kind: "number", value: Number(t.value) };
    if (t.type === "string") return { kind: "string", value: t.value };

    if (t.type === "lparen") {
      const inner = this.parseExpression();
      this.expect("rparen", '")"');
      return inner;
    }

    if (t.type === "ident") {
      if (t.value === "true") return { kind: "boolean", value: true };
      if (t.value === "false") return { kind: "boolean", value: false };
      if (t.value === "null") return { kind: "null" };

      if (this.peek().type === "lparen") {
        this.next();
        const args: Node[] = [];
        if (this.peek().type !== "rparen") {
          for (;;) {
            args.push(this.parseExpression());
            if (this.peek().type !== "comma") break;
            this.next();
            if (args.length > AST_LIMITS.maxArgs) {
              throw new ExprSyntaxError(
                `too many arguments (limit ${AST_LIMITS.maxArgs})`, this.peek().pos,
              );
            }
          }
        }
        this.expect("rparen", '")" to close the argument list');

        if (t.value === MEASURE_REF) {
          const [only] = args;
          if (args.length !== 1 || !only || only.kind !== "field") {
            throw new ExprSyntaxError(
              "measure() takes exactly one measure id, e.g. measure(revenue)", t.pos,
            );
          }
          return { kind: "measure", id: only.name, pos: t.pos };
        }
        if (isReservedName(t.value)) {
          throw new ExprSyntaxError(`"${t.value}" is a reserved name`, t.pos);
        }
        return { kind: "call", name: t.value, args, pos: t.pos };
      }

      if (KEYWORDS.has(t.value)) {
        throw new ExprSyntaxError(`"${t.value}" is a keyword and cannot be used as a name`, t.pos);
      }
      if (isReservedName(t.value)) {
        throw new ExprSyntaxError(`"${t.value}" is a reserved name`, t.pos);
      }
      return { kind: "field", name: t.value, pos: t.pos };
    }

    throw new ExprSyntaxError(
      `unexpected ${t.type === "eof" ? "end of expression" : `"${t.value}"`}`, t.pos,
    );
  }

  atEnd(): boolean {
    return this.peek().type === "eof";
  }

  position(): number {
    return this.peek().pos;
  }
}

export function parse(source: string): Node {
  const parser = new Parser(tokenize(source));
  const node = parser.parseExpression();
  if (!parser.atEnd()) {
    throw new ExprSyntaxError("unexpected trailing input", parser.position());
  }
  const n = countNodes(node);
  if (n > AST_LIMITS.maxNodes) {
    throw new ExprSyntaxError(`expression has ${n} nodes, over the limit of ${AST_LIMITS.maxNodes}`, 0);
  }
  const d = depth(node);
  if (d > AST_LIMITS.maxDepth) {
    throw new ExprSyntaxError(`expression nests ${d} deep, over the limit of ${AST_LIMITS.maxDepth}`, 0);
  }
  return node;
}

export { ExprSyntaxError } from "./tokenize.js";
