/** Tags are typed as a free-form list ("core, parser" or "#core #parser");
 *  todomd validates them, this just splits and tidies. */
export function parseTags(input: string): string[] {
  return input
    .split(/[\s,]+/)
    .map((tag) => tag.replace(/^#/, '').trim().toLowerCase())
    .filter(Boolean)
}
