const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  // API keys (sk-xxx, ak-xxx)
  [/\b(sk|ak)-[a-zA-Z0-9]{20,}\b/g, '$1-***REDACTED***'],
  // Bearer tokens
  [/Bearer\s+[a-zA-Z0-9._\-]+/gi, 'Bearer ***REDACTED***'],
  // token= parameter
  [/(token\s*[=:]\s*)[^\s,;'"]+/gi, '$1***REDACTED***'],
  // secret= parameter
  [/(secret\s*[=:]\s*)[^\s,;'"]+/gi, '$1***REDACTED***'],
  // password= parameter
  [/(password\s*[=:]\s*)[^\s,;'"]+/gi, '$1***REDACTED***'],
  // Database URLs with credentials
  [/(postgres|mysql|sqlite):\/\/[^:]+:[^@]+@/gi, '$1://***:***@'],
  // X-Desktop-Secret header
  [/(X-Desktop-Secret:\s*)[a-fA-F0-9]+/g, '$1***REDACTED***'],
  // Common API key env vars
  [/(DASHSCOPE_API_KEY|OPENAI_API_KEY|API_KEY|ANTHROPIC_API_KEY)\s*[=:]\s*[^\s,;'"]+/gi, '$1=***REDACTED***'],
];

export function sanitize(text: string): string {
  let result = text;
  for (const [pattern, replacement] of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}
