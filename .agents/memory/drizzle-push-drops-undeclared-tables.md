---
name: drizzle-kit push drops undeclared tables
description: Why `db:push` is unsafe in this project and how to add a column without losing data
---

# Never run `drizzle-kit push` on this database

This project's Postgres schema is **larger than `shared/schema.ts`**. Several
tables are created and used only through raw SQL and were never declared as
`pgTable`s — among them `room_type_groupings`, `manual_rate_overrides`, and
`competitor_rates`. They are referenced in hundreds of raw SQL sites across
`server/`.

`drizzle-kit push` diffs the live database against `shared/schema.ts` and treats
**anything not declared as something to delete**. Running
`npm run db:push -- --force` to add columns therefore dropped those tables
outright and emptied `rent_roll_data` and `rent_roll_history`.

**Why:** `--force` exists to skip the interactive prompt that lists destructive
statements. On a schema file that is only a partial model of the database, that
prompt is the *only* thing standing between an additive change and mass data
loss. The data in these tables comes from client Excel imports and hand-entered
operator overrides, so much of it is not reproducible from anything in the repl.

**How to apply:** to add or change a column, write the DDL directly and run it
against `DATABASE_URL`:

```sql
ALTER TABLE rent_roll_data ADD COLUMN IF NOT EXISTS my_new_col real;
```

Then mirror the column in `shared/schema.ts` so Drizzle queries can see it.
Editing the schema file is safe on its own; it is only `push` that is
destructive. If a diff genuinely must be generated, use `drizzle-kit generate`
and read the emitted migration before applying it — never `push`, and never
`--force`.

Before any schema work, sanity-check the gap:

```
comm -13 <(grep -o 'pgTable("[a-z_]*"' shared/schema.ts | sed 's/.*"\(.*\)"/\1/' | sort -u) \
         <(psql "$DATABASE_URL" -Atc "SELECT table_name FROM information_schema.tables WHERE table_schema='public'" | sort -u)
```

Every table listed is one `push` would drop.
