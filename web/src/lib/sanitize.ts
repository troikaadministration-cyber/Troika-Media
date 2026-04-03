/** Strip characters that could be used for PostgREST filter injection */
export function sanitizeForPostgrest(input: string): string {
  return input.replace(/[,.()"'\\]/g, '');
}
