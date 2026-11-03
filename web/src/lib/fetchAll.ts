/**
 * Fetch every row of a query, page by page.
 *
 * The Supabase API caps a single response (1000 rows by default), and a plain
 * `.limit(500)` silently hides everything past the limit. Use this for lists
 * that must be complete. The query must have a deterministic order (end with
 * `.order('id')`) so pages don't overlap or skip rows.
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  pageSize = 1000,
  maxRows = 50_000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data as T[] | null) ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}
