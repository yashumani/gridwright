export type TokenType =
  | "number" | "string" | "ident" | "op" | "lparen" | "rparen" | "comma" | "eof";

export interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

export class ExprSyntaxError extends Error {
  constructor(message: string, readonly pos: number) {
    super(message);
    this.name = "ExprSyntaxError";
  }
}

const OPERATORS = ["<=", ">=", "!=", "<>", "==", "=", "<", ">", "+", "-", "*", "/", "%"];

const isDigit = (c: string) => c >= "0" && c <= "9";
const isIdentStart = (c: string) => /[A-Za-z_]/.test(c);
const isIdentPart = (c: string) => /[A-Za-z0-9_]/.test(c);

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;

  while (i < src.length) {
    const c = src[i]!;

    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }

    if (c === "(") { out.push({ type: "lparen", value: c, pos: i++ }); continue; }
    if (c === ")") { out.push({ type: "rparen", value: c, pos: i++ }); continue; }
    if (c === ",") { out.push({ type: "comma", value: c, pos: i++ }); continue; }

    if (c === '"' || c === "'") {
      const start = i;
      const quote = c;
      i++;
      let value = "";
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") {
          const next = src[i + 1];
          if (next === undefined) throw new ExprSyntaxError("unterminated escape", i);
          value += next === "n" ? "\n" : next === "t" ? "\t" : next;
          i += 2;
          continue;
        }
        value += src[i];
        i++;
      }
      if (i >= src.length) throw new ExprSyntaxError("unterminated string literal", start);
      i++; // closing quote
      out.push({ type: "string", value, pos: start });
      continue;
    }

    if (isDigit(c) || (c === "." && isDigit(src[i + 1] ?? ""))) {
      const start = i;
      while (i < src.length && isDigit(src[i]!)) i++;
      if (src[i] === ".") {
        i++;
        while (i < src.length && isDigit(src[i]!)) i++;
      }
      if (src[i] === "e" || src[i] === "E") {
        const save = i;
        i++;
        if (src[i] === "+" || src[i] === "-") i++;
        if (!isDigit(src[i] ?? "")) i = save;
        else while (i < src.length && isDigit(src[i]!)) i++;
      }
      const text = src.slice(start, i);
      if (!Number.isFinite(Number(text))) throw new ExprSyntaxError(`invalid number "${text}"`, start);
      out.push({ type: "number", value: text, pos: start });
      continue;
    }

    if (isIdentStart(c)) {
      const start = i;
      while (i < src.length && isIdentPart(src[i]!)) i++;
      out.push({ type: "ident", value: src.slice(start, i), pos: start });
      continue;
    }

    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (op) {
      // Normalise the accepted spellings onto one canonical form.
      const canonical = op === "==" ? "=" : op === "<>" ? "!=" : op;
      out.push({ type: "op", value: canonical, pos: i });
      i += op.length;
      continue;
    }

    throw new ExprSyntaxError(`unexpected character "${c}"`, i);
  }

  out.push({ type: "eof", value: "", pos: src.length });
  return out;
}
