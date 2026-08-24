# Bavaria Tenant Bootstrap Verification

## Authenticated browser evidence

On 2026-08-24, an authenticated Bavaria AN session opened the production Catalog route at `https://bimmers-erp.vercel.app/catalog` after release `a96e8a2`. The route rendered the Catalog shell without an SSR error boundary and exposed seeded BMW chassis filters (including E30, E36, E46, and E90) and catalog category options.

The same authenticated session then opened `https://bimmers-erp.vercel.app/receipts`. The receipts ledger rendered successfully with active treasury choices and voucher controls, including the primary treasury and cash drawer options. No backfill or destructive operation beyond the confirmed bootstrap’s null-category assignment was invoked manually.

The session also opened `https://bimmers-erp.vercel.app/pos`. The rendered DOM contained the walk-in account reference `ACC-0001` and a product-search input, with no generic application-error boundary text present.
