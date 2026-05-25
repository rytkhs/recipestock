# Migrations

Run `pnpm db:generate` after changing `packages/db/src/schema`.

The first database setup should also enable `pg_trgm` for search:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```
