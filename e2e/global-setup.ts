import postgres from "postgres";

const E2E_DB_NAME = "naming-things-e2e";
const E2E_DB_URL = `postgresql://localhost/${E2E_DB_NAME}`;

// Tables in dependency order (children before parents) for truncation
const TABLES = [
  "naming-things_solo_run_answer",
  "naming-things_solo_run",
  "naming-things_category_alias",
  "naming-things_dispute_vote",
  "naming-things_answer_verification",
  "naming-things_answer",
  "naming-things_game_player",
  "naming-things_game",
  "naming-things_player",
  "naming-things_post",
];

async function globalSetup() {
  // Create the e2e database if it doesn't exist
  const adminSql = postgres("postgresql://localhost/postgres");
  try {
    const existing = await adminSql`
      SELECT 1 FROM pg_database WHERE datname = ${E2E_DB_NAME}
    `;
    if (existing.length === 0) {
      await adminSql.unsafe(`CREATE DATABASE "${E2E_DB_NAME}"`);
      console.log(`Created database ${E2E_DB_NAME}`);
    }
  } finally {
    await adminSql.end();
  }

  // Run migrations via drizzle-kit
  const { execSync } = await import("child_process");
  execSync(
    `DATABASE_URL=${E2E_DB_URL} npx drizzle-kit migrate`,
    { stdio: "pipe" },
  );

  // Truncate all tables for a clean slate
  const sql = postgres(E2E_DB_URL);
  try {
    await sql.unsafe(
      `TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} CASCADE`,
    );
  } finally {
    await sql.end();
  }
}

export default globalSetup;
