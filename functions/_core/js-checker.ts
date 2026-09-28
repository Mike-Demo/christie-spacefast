/**
 * Pure-JavaScript grammar checker for the SpaceFast preview.
 *
 * The SpaceFast edge runtime blocks WebAssembly compilation, so the Harper
 * engine cannot run server-side. This module implements a focused set of
 * high-precision checks in pure JS: repeated words, spacing, capitalization,
 * a/an agreement, and common misspellings.
 *
 * It mirrors the Harper result shape (RawLint[]) so the rest of the pipeline
 * (normalize → contract → MCP response) works unchanged.
 *
 * Privacy: text is processed in memory only, never persisted or logged.
 */

export interface JsRawLint {
  rule_id: string;
  category: string;
  message: string;
  start: number;
  end: number;
  suggestions: string[];
  safe: boolean;
}

interface Pattern {
  rule_id: string;
  category: string;
  message: string;
  regex: RegExp;
  suggest: (match: RegExpMatchArray) => string[];
  safe: boolean;
}

/** Common misspellings → correction. */
const MISSPELLINGS: Record<string, string> = {
  "recieve": "receive",
  "seperate": "separate",
  "definately": "definitely",
  "occured": "occurred",
  "accomodate": "accommodate",
  "neccessary": "necessary",
  "embarass": "embarrass",
  "liason": "liaison",
  "maintainance": "maintenance",
  "noticable": "noticeable",
  "occassion": "occasion",
  "publically": "publicly",
  "recomend": "recommend",
  "rythm": "rhythm",
  "suprise": "surprise",
  "tommorrow": "tomorrow",
  "truely": "truly",
  "untill": "until",
  "wich": "which",
  "wierd": "weird",
  "writting": "writing",
};

function wordAt(text: string, index: number): { word: string; start: number; end: number } | null {
  const m = /\b[\w']+\b/g;
  let match: RegExpExecArray | null;
  while ((match = m.exec(text)) !== null) {
    if (match.index <= index && index < match.index + match[0].length) {
      return { word: match[0], start: match.index, end: match.index + match[0].length };
    }
  }
  return null;
}

/**
 * Check text and return raw lints. Mirrors the shape of Harper's RawLint
 * so downstream normalize/contract code works unchanged.
 */
export function checkTextJs(text: string, maxChars: number): JsRawLint[] {
  const lints: JsRawLint[] = [];
  const seen = new Set<string>(); // dedupe by rule+span

  const push = (lint: JsRawLint) => {
    const key = `${lint.rule_id}:${lint.start}:${lint.end}`;
    if (seen.has(key)) return;
    seen.add(key);
    lints.push(lint);
  };

  // 1. Repeated words: "the the"
  for (const m of text.matchAll(/\b(\w+)\s+\1\b/gi)) {
    const word = m[1];
    // Allow intentional repeats like "had had" — only flag short common words
    if (/^(the|a|an|and|or|to|of|in|on|is|it|that|this)$/i.test(word)) {
      push({
        rule_id: "js.repeated_word",
        category: "repetition",
        message: `Repeated word: "${word}".`,
        start: m.index!,
        end: m.index! + m[0].length,
        suggestions: [word],
        safe: true,
      });
    }
  }

  // 2. Multiple spaces
  for (const m of text.matchAll(/ {2,}/g)) {
    push({
      rule_id: "js.extra_space",
      category: "formatting",
      message: "Multiple consecutive spaces.",
      start: m.index!,
      end: m.index! + m[0].length,
      suggestions: [" "],
      safe: true,
    });
  }

  // 3. Space before punctuation
  for (const m of text.matchAll(/\s+([,.!?;:])/g)) {
    push({
      rule_id: "js.space_before_punct",
      category: "punctuation",
      message: `No space before "${m[1]}".`,
      start: m.index!,
      end: m.index! + m[0].length,
      suggestions: [m[1]],
      safe: true,
    });
  }

  // 4. Missing capitalization at sentence start
  for (const m of text.matchAll(/(?:^|[.!?]\s+)([a-z])/g)) {
    const wordInfo = wordAt(text, m.index! + m[0].length - 1);
    if (wordInfo && !/^(i)$/i.test(wordInfo.word)) {
      const cap = wordInfo.word[0].toUpperCase() + wordInfo.word.slice(1);
      push({
        rule_id: "js.sentence_case",
        category: "capitalization",
        message: "Sentence should start with a capital letter.",
        start: wordInfo.start,
        end: wordInfo.start + 1,
        suggestions: [wordInfo.word[0].toUpperCase()],
        safe: true,
      });
    }
  }

  // 5. Common misspellings
  const lower = text.toLowerCase();
  for (const [wrong, right] of Object.entries(MISSPELLINGS)) {
    const re = new RegExp(`\\b${wrong}\\b`, "gi");
    for (const m of lower.matchAll(re)) {
      const original = text.slice(m.index!, m.index! + wrong.length);
      const fixed = original[0] === original[0].toUpperCase()
        ? right[0].toUpperCase() + right.slice(1)
        : right;
      push({
        rule_id: "js.spelling",
        category: "spelling",
        message: `Possible misspelling: "${original}". Did you mean "${fixed}"?`,
        start: m.index!,
        end: m.index! + wrong.length,
        suggestions: [fixed],
        safe: false, // spelling suggestions need human review
      });
    }
  }

  // 6. "a" vs "an" before vowel sounds (simplified: vowel letters)
  for (const m of text.matchAll(/\b(a|an)\s+([a-zA-Z])/gi)) {
    const article = m[1].toLowerCase();
    const next = m[2].toLowerCase();
    const isVowel = /^[aeiou]/.test(next);
    // Skip "an historic" style exceptions and acronyms for simplicity
    if (article === "a" && isVowel) {
      push({
        rule_id: "js.a_an",
        category: "grammar",
        message: `Use "an" before a vowel sound, not "a".`,
        start: m.index!,
        end: m.index! + 1,
        suggestions: [m[1][0] === "A" ? "An" : "an"],
        safe: true,
      });
    } else if (article === "an" && !isVowel) {
      push({
        rule_id: "js.a_an",
        category: "grammar",
        message: `Use "a" before a consonant sound, not "an".`,
        start: m.index!,
        end: m.index! + 2,
        suggestions: [m[1][0] === "A" ? "A" : "a"],
        safe: true,
      });
    }
  }

  // Sort by position for stable output
  lints.sort((a, b) => a.start - b.start || a.end - b.end);
  return lints.slice(0, 200); // cap output
}
