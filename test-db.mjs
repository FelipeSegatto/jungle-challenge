import pg from "pg";

const db = new pg.Client({
  connectionString: process.env.DATABASE_URL
});

try {
  await db.connect();

  console.log("✅ PostgreSQL conectado!");

  const result = await db.query(
    "SELECT current_user, current_database()"
  );

  console.log(result.rows);

} catch (error) {
  console.error("❌ Erro:", error.message);
  console.error("Código:", error.code);
  process.exitCode = 1;

} finally {
  await db.end().catch(() => {});
}
