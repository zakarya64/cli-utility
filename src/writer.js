'use strict';

const fs = require('fs-extra');
const path = require('path');
const { toSQLValue } = require('./db');

const BATCH_SIZE = 500; // rows per INSERT statement

/**
 * Write a complete SQL dump file for a single table.
 * Each file is self-contained and idempotent (DROP IF EXISTS + CREATE + INSERT).
 */
async function writeTableDump(opts) {
  const { outputDir, database, table, schema, rows, columnTypes, includeSchema, includeData } = opts;

  const filePath = path.join(outputDir, `${table}.sql`);
  const lines = [];

  // --- File header ---
  lines.push(sqlComment(`DataPull DB Backup — Table: \`${table}\``));
  lines.push(sqlComment(`Database: ${database}`));
  lines.push(sqlComment(`Generated: ${new Date().toISOString()}`));
  lines.push(sqlComment(`Rows: ${rows.length}`));
  lines.push('');
  lines.push('SET FOREIGN_KEY_CHECKS=0;');
  lines.push('SET SQL_MODE="NO_AUTO_VALUE_ON_ZERO";');
  lines.push('SET time_zone="+00:00";');
  lines.push('');

  // --- Schema block ---
  if (includeSchema !== false) {
    lines.push(sqlComment('Table structure'));
    lines.push(`DROP TABLE IF EXISTS \`${table}\`;`);
    lines.push(schema);
    lines.push('');
  }

  // --- Data block ---
  if (includeData !== false && rows.length > 0) {
    lines.push(sqlComment(`Table data — ${rows.length.toLocaleString()} rows`));

    const columns = Object.keys(rows[0]);
    const colList = columns.map(c => `\`${c}\``).join(', ');

    // Write in batches to keep file size manageable
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const values = batch.map(row => {
        const vals = columns.map(col => toSQLValue(row[col], columnTypes[col]));
        return `  (${vals.join(', ')})`;
      });
      lines.push(`INSERT INTO \`${table}\` (${colList}) VALUES`);
      lines.push(values.join(',\n') + ';');
      lines.push('');
    }
  } else if (includeData !== false && rows.length === 0) {
    lines.push(sqlComment('No data rows in this table'));
    lines.push('');
  }

  lines.push('SET FOREIGN_KEY_CHECKS=1;');

  await fs.writeFile(filePath, lines.join('\n'), 'utf8');
  return filePath;
}

/**
 * Write the master index file that ties everything together.
 * Running this single file restores the entire database in correct order.
 */
async function writeMasterDump(opts) {
  const { outputDir, database, tables, meta, includeSchema, includeData } = opts;

  const filePath = path.join(outputDir, `_restore_all.sql`);
  const lines = [];

  lines.push(sqlComment('='.repeat(60)));
  lines.push(sqlComment('DataPull DB Backup — Master Restore Script'));
  lines.push(sqlComment(`Database: ${database}`));
  lines.push(sqlComment(`Generated: ${new Date().toISOString()}`));
  lines.push(sqlComment(`Tables: ${tables.length}`));
  lines.push(sqlComment('='.repeat(60)));
  lines.push('');

  lines.push('SET FOREIGN_KEY_CHECKS=0;');
  lines.push('SET SQL_MODE="NO_AUTO_VALUE_ON_ZERO";');
  lines.push(`SET NAMES '${meta.charset}';`);
  lines.push(`SET character_set_client = ${meta.charset};`);
  lines.push('');

  if (includeSchema !== false) {
    lines.push(sqlComment('Create database if it does not exist'));
    lines.push(`CREATE DATABASE IF NOT EXISTS \`${database}\``);
    lines.push(`  DEFAULT CHARACTER SET ${meta.charset}`);
    lines.push(`  DEFAULT COLLATE ${meta.collation};`);
    lines.push(`USE \`${database}\`;`);
    lines.push('');
  }

  lines.push(sqlComment('Source individual table files'));
  for (const table of tables) {
    lines.push(`SOURCE ${table}.sql;`);
  }

  lines.push('');
  lines.push('SET FOREIGN_KEY_CHECKS=1;');
  lines.push('');
  lines.push(sqlComment('Restore complete.'));

  await fs.writeFile(filePath, lines.join('\n'), 'utf8');
  return filePath;
}

/**
 * Write a JSON manifest with backup metadata.
 */
async function writeManifest(opts) {
  const { outputDir, database, host, tables, totalRows, startedAt, completedAt } = opts;

  const manifest = {
    tool: 'dbbackup-cli',
    version: require('../package.json').version,
    backup: {
      database,
      host,
      startedAt,
      completedAt,
      durationMs: new Date(completedAt) - new Date(startedAt),
      tables: tables.map(t => ({
        name: t.name,
        rows: t.rows,
        fileSizeBytes: t.fileSizeBytes,
      })),
      totalTables: tables.length,
      totalRows,
    },
  };

  const filePath = path.join(outputDir, '_manifest.json');
  await fs.writeJson(filePath, manifest, { spaces: 2 });
  return filePath;
}

function sqlComment(text) {
  return `-- ${text}`;
}

module.exports = { writeTableDump, writeMasterDump, writeManifest };
