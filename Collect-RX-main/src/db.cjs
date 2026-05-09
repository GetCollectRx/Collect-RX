const { Pool } = require("pg");
const logger = require("./logger");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on("error", (err) => {
  logger.error("Unexpected database pool error", { error: err.message });
});

const query = async (text, params) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug("Query executed", { duration: `${duration}ms`, rows: result.rowCount });
    return result;
  } catch (err) {
    logger.error("Database query error", { error: err.message, query: text });
    throw err;
  }
};

module.exports = { query, pool };
