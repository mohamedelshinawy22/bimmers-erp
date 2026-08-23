# Project TODO

- [x] Complete remaining authenticated route and server-action tenant-context audit.
- [x] Bind Daily Movement, inventory movement, settings, barcode, part-ledger, sales-return, purchase-return, and invoice editor paths to the strict resolver.
- [x] Replace Thermal Barcode Studio sample parts with tenant-scoped printable catalog data and safe empty states.
- [x] Verify and test Arabic Excel import/export mappings and transaction safety.
- [x] Add a non-secret authenticated-route smoke harness with clear session requirements and validate its no-cookie guard.
- [x] Run ERP unit tests, typecheck, production build, commit, push, and production deployment.
- [x] Run Master Hub verification tests, typecheck, build, checkpoint, and production deployment.
- [x] Re-audit all authenticated page loaders, layouts, and API routes for explicit tenant-context rebinding and safe fallbacks.
- [x] Harden spreadsheet export/import actions for tenant scope, Arabic/BMW data formatting, batch transaction safety, and duplicate summaries.
- [x] Extend Thermal Barcode Studio with tenant-catalog instant search by chassis, OEM/part number, and name, plus safe print preview defaults.
- [x] Add and run targeted SSR, spreadsheet export, and barcode payload regression coverage.
- [x] Run production validation, deploy the renewed ERP release, and verify live health boundaries.
