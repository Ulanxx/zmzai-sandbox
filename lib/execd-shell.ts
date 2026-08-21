/**
 * Quotes one argument for OpenSandbox Execd's shell command parser.
 *
 * Execd preserves double-quoted arguments but does not implement POSIX's
 * single-quote concatenation idiom. Escaping expansion-capable characters in
 * a double-quoted word keeps JavaScript, Python, paths, and user text intact.
 */
export function quoteExecdArgument(value: string): string {
  return `"${value.replace(/["\\$`]/g, "\\$&")}"`;
}
