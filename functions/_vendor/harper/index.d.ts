/**
 * Minimal type declarations for the vendored harper.js JS glue
 * (functions/_vendor/harper/index.js). Only the surface used by
 * `functions/_core/harper.ts` is declared.
 */

export interface BinaryModule {
  url: string | URL;
  setup(): Promise<void>;
}

export interface LintSpan {
  start: number;
  end: number;
}

export interface LintSuggestion {
  kind(): number;
  get_replacement_text(): string;
}

export interface Lint {
  lint_kind(): string;
  message(): string;
  span(): LintSpan;
  suggestions(): LintSuggestion[];
}

export declare class LocalLinter {
  constructor(options: { binary: BinaryModule; dialect?: unknown });
  setup(): Promise<void>;
  lint(text: string, options?: Record<string, unknown>): Promise<Lint[]>;
  organizedLints(
    text: string,
    options?: Record<string, unknown>,
  ): Promise<Record<string, Lint[]>>;
}

export declare function createBinaryModuleFromUrl(
  url: string | URL,
  glueFlavor?: "full" | "slim",
): BinaryModule;
