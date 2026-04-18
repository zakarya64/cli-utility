'use strict';

const mysql = require('mysql2/promise');
const chalk = require('chalk');

/**
 * Create and test a MySQL connection.
 * Returns a connection object ready for queries.
 */
async function createConnection(opts) {
  const config = {
    host: opts.host || 'localhost',
    port: parseInt(opts.port || 3306, 10),
    user: opts.user,
    password: opts.password || '',
    database: opts.database,
    multipleStatements: true,
    connectTimeout: 10000,
  };

  let connection;
  try {
    connection = await mysql.createConnection(config);
    await connection.ping();
  } catch (err) {
    const msg = friendlyError(err);
    throw new Error(msg);
  }

  return connection;
}

/**
 * Fetch all user-created tables in the target database.
 */
async function getTables(conn, database) {
  const [rows] = await conn.query(
    `SELECT table_name 
     FROM information_schema.tables 
     WHERE table_schema = ? 
       AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
    [database]
  );
  return rows.map(r => r.table_name || r.TABLE_NAME);
}

/**
 * Fetch the CREATE TABLE statement for a given table.
 */
async function getTableSchema(conn, table) {
  const [rows] = await conn.query(`SHOW CREATE TABLE \`${table}\``);
  const row = rows[0];
  return (row['Create Table'] || row['CREATE TABLE']) + ';';
}

/**
 * Fetch all rows from a table.
 */
async function getTableData(conn, table) {
  const [rows] = await conn.query(`SELECT * FROM \`${table}\``);
  return rows;
}

/**
 * Fetch column metadata for a table.
 */
async function getColumnTypes(conn, database, table) {
  const [rows] = await conn.query(
    `SELECT column_name, data_type 
     FROM information_schema.columns 
     WHERE table_schema = ? AND table_name = ?
     ORDER BY ordinal_position`,
    [database, table]
  );
  const map = {};
  rows.forEach(r => {
    map[r.column_name || r.COLUMN_NAME] = r.data_type || r.DATA_TYPE;
  });
  return map;
}

/**
 * Fetch database-level metadata: charset, collation, engine.
 */
async function getDatabaseMeta(conn, database) {
  const [rows] = await conn.query(
    `SELECT default_character_set_name, default_collation_name
     FROM information_schema.schemata
     WHERE schema_name = ?`,
    [database]
  );
  const row = rows[0] || {};
  return {
    charset: row.default_character_set_name || row.DEFAULT_CHARACTER_SET_NAME || 'utf8mb4',
    collation: row.default_collation_name || row.DEFAULT_COLLATION_NAME || 'utf8mb4_unicode_ci',
  };
}

/**
 * Fetch foreign key relationships for ordering (simple topological info).
 */
async function getForeignKeys(conn, database) {
  const [rows] = await conn.query(
    `SELECT table_name, referenced_table_name
     FROM information_schema.key_column_usage
     WHERE table_schema = ?
       AND referenced_table_name IS NOT NULL`,
    [database]
  );
  return rows.map(r => ({
    table: r.table_name || r.TABLE_NAME,
    references: r.referenced_table_name || r.REFERENCED_TABLE_NAME,
  }));
}

/**
 * Convert a raw JS value to a safe SQL literal string.
 */
function toSQLValue(value, dataType) {
  if (value === null || value === undefined) return 'NULL';

  const numericTypes = ['int', 'bigint', 'smallint', 'tinyint', 'mediumint',
    'float', 'double', 'decimal', 'numeric', 'bit'];
  const binaryTypes = ['blob', 'tinyblob', 'mediumblob', 'longblob', 'binary', 'varbinary'];
  const dateTypes = ['date', 'datetime', 'timestamp', 'time', 'year'];

  const dt = (dataType || '').toLowerCase();

  if (numericTypes.some(t => dt.includes(t))) {
    return String(value);
  }

  if (binaryTypes.some(t => dt.includes(t))) {
    return `X'${Buffer.from(value).toString('hex')}'`;
  }

  if (value instanceof Date) {
    return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
  }

  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'`;

  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;
}

function friendlyError(err) {
  if (err.code === 'ECONNREFUSED') return `Connection refused — is MySQL running on ${err.address}:${err.port}?`;
  if (err.code === 'ER_ACCESS_DENIED_ERROR') return 'Access denied — check your username and password.';
  if (err.code === 'ER_BAD_DB_ERROR') return `Database not found — double-check the database name.`;
  if (err.code === 'ETIMEDOUT') return 'Connection timed out — check host and firewall settings.';
  if (err.code === 'ENOTFOUND') return `Host not found — "${err.hostname}" could not be resolved.`;
  return err.message;
}

module.exports = {
  createConnection,
  getTables,
  getTableSchema,
  getTableData,
  getColumnTypes,
  getDatabaseMeta,
  getForeignKeys,
  toSQLValue,
};
