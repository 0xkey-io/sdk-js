import { CommerceCodecError } from "./codec-error";

export function parseCommerceJson(input: string | Uint8Array): unknown {
  let source: string;
  try {
    source =
      typeof input === "string"
        ? input
        : new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    throw new CommerceCodecError("SCHEMA_INVALID");
  }
  return new StrictJsonParser(source).parse();
}

class StrictJsonParser {
  private offset = 0;

  constructor(private readonly source: string) {}

  parse(): unknown {
    const value = this.value();
    this.whitespace();
    if (this.offset !== this.source.length) this.invalid();
    return value;
  }

  private value(): unknown {
    this.whitespace();
    const token = this.source[this.offset];
    if (token === "{") return this.object();
    if (token === "[") return this.array();
    if (token === '"') return this.string();
    if (
      token === "-" ||
      (token !== undefined && token >= "0" && token <= "9")
    ) {
      return this.number();
    }
    for (const [literal, value] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (this.source.startsWith(literal, this.offset)) {
        this.offset += literal.length;
        return value;
      }
    }
    return this.invalid();
  }

  private object(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const keys = new Set<string>();
    this.offset += 1;
    this.whitespace();
    if (this.source[this.offset] === "}") {
      this.offset += 1;
      return result;
    }
    while (true) {
      this.whitespace();
      if (this.source[this.offset] !== '"') return this.invalid();
      const key = this.string();
      if (keys.has(key)) return this.invalid();
      keys.add(key);
      this.whitespace();
      if (this.source[this.offset] !== ":") return this.invalid();
      this.offset += 1;
      Object.defineProperty(result, key, {
        value: this.value(),
        enumerable: true,
        configurable: true,
        writable: true,
      });
      this.whitespace();
      if (this.source[this.offset] === "}") {
        this.offset += 1;
        return result;
      }
      if (this.source[this.offset] !== ",") return this.invalid();
      this.offset += 1;
    }
  }

  private array(): unknown[] {
    const result: unknown[] = [];
    this.offset += 1;
    this.whitespace();
    if (this.source[this.offset] === "]") {
      this.offset += 1;
      return result;
    }
    while (true) {
      result.push(this.value());
      this.whitespace();
      if (this.source[this.offset] === "]") {
        this.offset += 1;
        return result;
      }
      if (this.source[this.offset] !== ",") return this.invalid();
      this.offset += 1;
    }
  }

  private string(): string {
    const start = this.offset;
    this.offset += 1;
    let escaped = false;
    while (this.offset < this.source.length) {
      const character = this.source[this.offset]!;
      this.offset += 1;
      if (!escaped && character === '"') {
        try {
          return JSON.parse(this.source.slice(start, this.offset)) as string;
        } catch {
          return this.invalid();
        }
      }
      if (!escaped && character.charCodeAt(0) < 0x20) return this.invalid();
      if (!escaped && character === "\\") escaped = true;
      else escaped = false;
    }
    return this.invalid();
  }

  private number(): number {
    const match = this.source
      .slice(this.offset)
      .match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (!match) return this.invalid();
    this.offset += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) return this.invalid();
    return value;
  }

  private whitespace(): void {
    while ([" ", "\t", "\n", "\r"].includes(this.source[this.offset] ?? "")) {
      this.offset += 1;
    }
  }

  private invalid(): never {
    throw new CommerceCodecError("SCHEMA_INVALID");
  }
}
