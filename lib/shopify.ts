/**
 * Fetch numeric ProductVariant IDs (legacyResourceId) for a list of SKUs.
 * Returns a Map<sku, variantId>.
 */
export async function fetchVariantIdsBySkus(
  skus: string[],
  chunkSize = 25
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!skus || skus.length === 0) return out;

  // Helper to escape quotes in SKUs for the search query
  const esc = (s: string) => String(s).replace(/"/g, '\\"');

  // We batch to keep the GraphQL query size reasonable
  for (let i = 0; i < skus.length; i += chunkSize) {
    const batch = skus.slice(i, i + chunkSize);
    const queryString = batch.map((s) => `sku:"${esc(s)}"`).join(" OR ");

    const query = `
      query VariantsBySku($q: String!, $first: Int!) {
        productVariants(first: $first, query: $q) {
          edges {
            node {
              id
              sku
              legacyResourceId
            }
          }
        }
      }
    `;

    type Gx = {
      productVariants: {
        edges: Array<{
          node: {
            id: string;                 // gid://shopify/ProductVariant/123
            sku: string | null;
            legacyResourceId?: string | null; // "123"
          };
        }>;
      };
    };

    const data = await shopifyGraphql<Gx>(query, { q: queryString, first: 250 });

    for (const edge of data?.productVariants?.edges || []) {
      const sku = (edge.node.sku || "").trim();
      if (!sku) continue;

      // Prefer legacyResourceId (numeric). Fallback: parse from gid.
      const legacy = edge.node.legacyResourceId || gidToNumericId(edge.node.id);
      if (!legacy) continue;

      // Only set the first mapping we find for a SKU (in case of duplicates)
      if (!out.has(sku)) out.set(sku, String(legacy));
    }
  }

  return out;
}
