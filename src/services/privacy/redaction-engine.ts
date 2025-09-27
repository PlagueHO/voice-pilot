import { RedactionMatch, RedactionResult, RedactionRule } from '../../types/speech-to-text';

function normalizePattern(pattern: RegExp | string): RegExp | undefined {
  if (pattern instanceof RegExp) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    return new RegExp(pattern.source, flags);
  }
  if (typeof pattern === 'string' && pattern.length > 0) {
    return new RegExp(pattern, 'gi');
  }
  return undefined;
}

export function applyRedactions(content: string, rules: RedactionRule[]): RedactionResult {
  if (!content || rules.length === 0) {
    return { content, matches: [] };
  }

  let sanitized = content;
  const matches: RedactionMatch[] = [];

  for (const rule of rules) {
    const normalized = normalizePattern(rule.pattern);
    if (!normalized) {
      continue;
    }

    sanitized = sanitized.replace(normalized, (match: string, ...args: unknown[]) => {
      const offsetArg = args[args.length - 2];
      const offset = typeof offsetArg === 'number' ? offsetArg : sanitized.indexOf(match);
      matches.push({
        ruleId: rule.id,
        originalText: match,
        replacementText: rule.replacement,
        startIndex: offset,
        endIndex: offset + match.length
      });
      return rule.replacement;
    });
  }

  return { content: sanitized, matches };
}
