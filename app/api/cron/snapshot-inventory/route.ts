// app/api/cron/snapshot-inventory/route.ts  (only showing the query + mapping)

// ✅ CORRECT GraphQL
const QUERY = /* GraphQL */ `
  query InvSnapshot($cursor: String) {
    products(first: 50, query: "status:active", after: $cursor) {
      edges {
        cursor
        node {
          variants(first: 100) {
            edges {
              node {
                sku
                inventoryItem {
                  inventoryLevels(first: 50) {
                    edges {
                      node {
                        location { id name }
                        # ⬇️ MUST be an array of strings; name is lowercase
                        quantities(names: ["available"]) {
                          name
                          quantity   # ⬅️ the numeric value you need
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
