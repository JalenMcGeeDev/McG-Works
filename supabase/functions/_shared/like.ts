// Escapes Postgres LIKE/ILIKE wildcards (% _ \) so user input used as a
// pattern can only ever match itself — prevents wildcard-injection auth bypass.
export function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, '\\$&')
}
