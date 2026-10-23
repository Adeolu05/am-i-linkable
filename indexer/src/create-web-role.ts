// One-off: create (or rotate) the read-only database role used by the website.
//
//   pnpm --filter indexer create-web-role            # create if missing, re-apply grants
//   pnpm --filter indexer create-web-role -- --rotate  # new password, rewrite apps/web/.env.local
//   pnpm --filter indexer create-web-role -- --verify  # read-only: catalog + probes as the role, changes nothing
//
// Uses DATABASE_URL_UNPOOLED (owner, direct) for DDL and DATABASE_URL (pooled)
// as the template for the website's connection string. The generated password
// and URL are written only to apps/web/.env.local (gitignored) and are never printed.

import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { describeError, loadEnv, REPO_ROOT, requireEnv, withStrictSsl } from "./env";
import { readonlyUrl, upsertEnvLine, WEB_ROLE, WEB_TABLES } from "./web-role";

const ENV_FILE = path.join(REPO_ROOT, "apps", "web", ".env.local");
const ENV_VAR = "DATABASE_URL_READONLY";

async function envFileHasVar(): Promise<boolean> {
  try {
    return (await readFile(ENV_FILE, "utf8")).split(/\r?\n/).some((l) => l.startsWith(`${ENV_VAR}=`));
  } catch {
    return false;
  }
}

async function writeEnvFile(url: string) {
  let text = "";
  try {
    text = await readFile(ENV_FILE, "utf8");
  } catch {
    text = "# Local secrets for apps/web. Gitignored; never commit.\n";
  }
  await writeFile(ENV_FILE, upsertEnvLine(text, ENV_VAR, url), { mode: 0o600 });
}

/** Runs `sql` in a read-write transaction that is always rolled back; true if Postgres refused it. */
async function refused(client: pg.Client, sql: string): Promise<boolean> {
  try {
    await client.query("begin read write");
    await client.query(sql);
    return false;
  } catch {
    return true;
  } finally {
    await client.query("rollback").catch(() => {});
  }
}

async function main() {
  loadEnv();
  if (process.argv.includes("--verify")) {
    await verifyCatalog();
    await verifyAsWebRole();
    return;
  }
  const ownerUrl = requireEnv("DATABASE_URL_UNPOOLED", "The owner's direct connection string is needed to create roles.");
  const pooledUrl = requireEnv("DATABASE_URL", "The pooled connection string is the template for the website's URL.");
  const rotate = process.argv.includes("--rotate");

  const owner = new pg.Client({ connectionString: withStrictSsl(ownerUrl), connectionTimeoutMillis: 15_000 });
  await owner.connect();
  let password: string | undefined;
  try {
    const { rows } = await owner.query("select current_database() as db, current_user as me, exists(select 1 from pg_roles where rolname = $1) as present", [WEB_ROLE]);
    const { db, me, present } = rows[0] as { db: string; me: string; present: boolean };
    const role = owner.escapeIdentifier(WEB_ROLE);

    if (!present || rotate) {
      // 32 random bytes, base64url: 256 bits of entropy, URL-safe.
      password = randomBytes(32).toString("base64url");
      const pw = owner.escapeLiteral(password);
      if (!present) {
        await owner.query(
          `create role ${role} with login password ${pw} nosuperuser nocreatedb nocreaterole noinherit noreplication connection limit 20`,
        );
        console.log(`${WEB_ROLE}: created`);
      } else {
        await owner.query(`alter role ${role} with password ${pw}`);
        console.log(`${WEB_ROLE}: password rotated`);
      }
    } else {
      console.log(`${WEB_ROLE}: already exists`);
    }

    // Grants are re-applied on every run, so the role always matches this file.
    const dbId = owner.escapeIdentifier(db);
    const ownerId = owner.escapeIdentifier(me);
    const statements = [
      `revoke all on database ${dbId} from ${role}`,
      `grant connect on database ${dbId} to ${role}`,
      // No temporary tables for anyone but the owner.
      `revoke temporary on database ${dbId} from public`,
      `revoke all on schema public from ${role}`,
      `revoke create on schema public from public`,
      `grant usage on schema public to ${role}`,
      `revoke all on all tables in schema public from ${role}`,
      `revoke all on all sequences in schema public from ${role}`,
      `grant select on ${WEB_TABLES.map((t) => owner.escapeIdentifier(t)).join(", ")} to ${role}`,
      // Tables the owner creates later grant the web role nothing.
      `alter default privileges for role ${ownerId} in schema public revoke all on tables from ${role}`,
      `alter default privileges for role ${ownerId} in schema public revoke all on sequences from ${role}`,
      // Belt and braces: the role's sessions are read-only and short.
      `alter role ${role} set default_transaction_read_only = on`,
      `alter role ${role} set statement_timeout = '15s'`,
    ];
    for (const s of statements) await owner.query(s);
    console.log(`${WEB_ROLE}: privileges applied (select on ${WEB_TABLES.join(", ")})`);
  } finally {
    await owner.end();
  }

  if (password) {
    const url = readonlyUrl(pooledUrl, password);
    process.env[ENV_VAR] = url; // so redact() also covers it in any error below
    await writeEnvFile(url);
    console.log(`apps/web/.env.local: ${ENV_VAR} written`);
  } else if (!(await envFileHasVar())) {
    console.log(`apps/web/.env.local has no ${ENV_VAR}; the existing password cannot be recovered. Re-run with --rotate.`);
    return;
  }

  await verifyAsWebRole();
}

const yes = (b: boolean) => (b ? "yes" : "NO");

/** Read-only: what the catalog says the role may do. Changes nothing. */
async function verifyCatalog() {
  const owner = new pg.Client({ connectionString: withStrictSsl(requireEnv("DATABASE_URL", "The pooled connection string is needed to read the catalog.")), connectionTimeoutMillis: 15_000 });
  await owner.connect();
  try {
    const { rows } = await owner.query(
      "select rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit, rolconnlimit, rolconfig from pg_roles where rolname = $1",
      [WEB_ROLE],
    );
    const r = rows[0];
    if (!r) throw new Error(`${WEB_ROLE} does not exist`);
    console.log(`catalog: superuser ${r.rolsuper}, createdb ${r.rolcreatedb}, createrole ${r.rolcreaterole}, replication ${r.rolreplication}, bypassrls ${r.rolbypassrls}, inherit ${r.rolinherit}, connection limit ${r.rolconnlimit}`);
    console.log(`catalog: settings ${(r.rolconfig ?? []).join(", ")}`);
    const grants = await owner.query(
      "select table_name, string_agg(privilege_type, ',' order by privilege_type) as privs from information_schema.role_table_grants where grantee = $1 group by table_name order by table_name",
      [WEB_ROLE],
    );
    console.log(`catalog: table grants ${grants.rows.map((g) => `${g.table_name}(${g.privs})`).join(" ") || "none"}`);
    const member = await owner.query(
      "select r.rolname from pg_auth_members m join pg_roles r on r.oid = m.roleid join pg_roles u on u.oid = m.member where u.rolname = $1",
      [WEB_ROLE],
    );
    console.log(`catalog: member of ${member.rows.map((m) => m.rolname).join(", ") || "no other role"}`);
  } finally {
    await owner.end();
  }
}

/** Connects as the web role, over the pooled connection the website uses, and probes what it may do. */
async function verifyAsWebRole() {
  const text = await readFile(ENV_FILE, "utf8");
  const url = text.split(/\r?\n/).find((l) => l.startsWith(`${ENV_VAR}=`))!.slice(ENV_VAR.length + 1);
  process.env[ENV_VAR] = url;
  const web = new pg.Client({ connectionString: withStrictSsl(url), connectionTimeoutMillis: 15_000 });
  await web.connect();
  try {
    const canSelect = await web.query("select key from snapshots limit 1").then(() => true, () => false);
    console.log(`verify: SELECT snapshots allowed: ${yes(canSelect)}`);
    console.log(`verify: INSERT refused: ${yes(await refused(web, "insert into snapshots (key, generated_at, etag, row_count, json_bytes, body_gzip) values ('_probe', now(), 'x', 0, 0, '')"))}`);
    console.log(`verify: UPDATE refused: ${yes(await refused(web, "update snapshots set etag = etag"))}`);
    console.log(`verify: DELETE refused: ${yes(await refused(web, "delete from snapshots where key = '_probe'"))}`);
    console.log(`verify: CREATE TABLE refused: ${yes(await refused(web, "create table _probe (x int)"))}`);
    for (const t of ["turnstile_events", "event_addresses", "meta"]) {
      console.log(`verify: SELECT ${t} refused (not granted): ${yes(await refused(web, `select 1 from ${t} limit 1`))}`);
    }
  } finally {
    await web.end();
  }
}

main().catch((err) => {
  console.error(`create-web-role failed: ${describeError(err)}`);
  process.exit(1);
});
