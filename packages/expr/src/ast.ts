export type BinaryOp =
  | "+" | "-" | "*" | "/" | "%"
  | "=" | "!=" | "<" | "<=" | ">" | ">="
  | "and" | "or";

export type UnaryOp = "-" | "not";

export type Node =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "null" }
  /** A bare identifier: a column of the source data. */
  | { kind: "field"; name: string; pos: number }
  /** A reference to another measure by id — resolved after aggregation. */
  | { kind: "measure"; id: string; pos: number }
  | { kind: "call"; name: string; args: Node[]; pos: number }
  | { kind: "unary"; op: UnaryOp; operand: Node }
  | { kind: "binary"; op: BinaryOp; left: Node; right: Node };

/** Structural limits. An expression is untrusted input like any other. */
export const AST_LIMITS = {
  maxDepth: 32,
  maxNodes: 500,
  maxArgs: 16,
  /**
   * Guards the parser's own recursion. Parenthesised groups collapse to their
   * inner node, so `(((...)))` has an AST depth of 1 no matter how deep the
   * source nests — the stack has to be bounded during the parse, not after it.
   */
  maxParseDepth: 64,
} as const;

export function walk(node: Node, visit: (n: Node) => void): void {
  visit(node);
  switch (node.kind) {
    case "call":
      for (const a of node.args) walk(a, visit);
      break;
    case "unary":
      walk(node.operand, visit);
      break;
    case "binary":
      walk(node.left, visit);
      walk(node.right, visit);
      break;
    default:
      break;
  }
}

export function depth(node: Node): number {
  switch (node.kind) {
    case "call":
      return 1 + Math.max(0, ...node.args.map(depth));
    case "unary":
      return 1 + depth(node.operand);
    case "binary":
      return 1 + Math.max(depth(node.left), depth(node.right));
    default:
      return 1;
  }
}

export function countNodes(node: Node): number {
  let n = 0;
  walk(node, () => n++);
  return n;
}
