'use strict';

const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const ora = require('ora');
const { createConnection } = require('./db');

/**
 * Restore a database from a backup folder.
 * Reads all .sql files (except the master script) and executes them in order.
 */
async function runRestore(opts) {
  const errors = validateRestoreOpts(opts);
  if (errors.length) {
    console.error(chalk.red('\n✖ Missing required options:'));
    errors.forEach(e => console.error(chalk.red(`  • ${e}`)));
    process.exit(1);
  }

  const inputDir = path.resolve(opts.input);

  if (!await fs.pathExists(inputDir)) {
    console.error(chalk.red(`✖ Input path not found: ${inputDir}`));
    process.exit(1);
  }

  console.log(chalk.bold('\n  Restore Configuration'));
  console.log(chalk.gray('  ─────────────────────────────────────'));
  console.log(`  ${chalk.gray('Host')}       ${chalk.white(opts.host + ':' + (opts.port || 3306))}`);
  console.log(`  ${chalk.gray('User')}       ${chalk.white(opts.user)}`);
  console.log(`  ${chalk.gray('Database')}   ${chalk.white(opts.database)}`);
  console.log(`  ${chalk.gray('Source')}     ${chalk.white(inputDir)}`);
  console.log(`  ${chalk.gray('Drop first')} ${chalk.white(opts.drop ? 'yes' : 'no')}`);
  console.log('');

  // Read manifest if present
  const manifestPath = path.join(inputDir, '_manifest.json');
  let manifest = null;
  if (await fs.pathExists(manifestPath)) {
    manifest = await fs.readJson(manifestPath);
    const b = manifest.backup;
    console.log(chalk.gray(`  Backup from: ${b.host} — ${b.database} — ${b.startedAt}`));
    console.log(chalk.gray(`  Tables: ${b.totalTables}  |  Rows: ${b.totalRows.toLocaleString()}\n`));
  }

  // Connect (without specifying a database first, so we can create it)
  const connSpinner = ora('Connecting to database...').start();
  let conn;
  try {
    conn = await createConnection({ ...opts, database: undefined });
    connSpinner.succeed(chalk.green('Connected to ') + chalk.bold(opts.host));
  } catch (err) {
    connSpinner.fail(chalk.red('Connection failed: ') + err.message);
    process.exit(1);
  }

  try {
    // Create/select database
    const dbSpinner = ora(`Selecting database ${chalk.cyan(opts.database)}...`).start();
    try {
      await conn.query(`CREATE DATABASE IF NOT EXISTS \`${opts.database}\``);
      await conn.query(`USE \`${opts.database}\``);
      dbSpinner.succeed(`Using database ${chalk.cyan(opts.database)}`);
    } catch (err) {
      dbSpinner.fail('Could not select database: ' + err.message);
      process.exit(1);
    }

    // Gather .sql files (exclude master script)
    const allFiles = await fs.readdir(inputDir);
    const sqlFiles = allFiles
      .filter(f => f.endsWith('.sql') && f !== '_restore_all.sql')
      .sort();

    if (!sqlFiles.length) {
      console.error(chalk.red('✖ No SQL files found in the backup directory.'));
      process.exit(1);
    }

    console.log('');
    let restored = 0;
    let failed = 0;

    await conn.query('SET FOREIGN_KEY_CHECKS=0;');

    for (let i = 0; i < sqlFiles.length; i++) {
      const file = sqlFiles[i];
      const table = file.replace('.sql', '');
      const idx = chalk.gray(`[${String(i + 1).padStart(String(sqlFiles.length).length)}/${sqlFiles.length}]`);
      const spinner = ora(`${idx} Restoring ${chalk.cyan(table)}...`).start();

      try {
        let sql = await fs.readFile(path.join(inputDir, file), 'utf8');

        if (opts.drop) {
          await conn.query(`DROP TABLE IF EXISTS \`${table}\``);
        }

        // Execute the file contents — split on statement boundaries
        const statements = splitStatements(sql);
        for (const stmt of statements) {
          if (stmt.trim()) await conn.query(stmt);
        }

        spinner.succeed(`${idx} ${chalk.cyan(table.padEnd(30))} ${chalk.green('restored')}`);
        restored++;
      } catch (err) {
        spinner.fail(`${idx} ${chalk.cyan(table)} — ${chalk.red(err.message)}`);
        failed++;
      }
    }

    await conn.query('SET FOREIGN_KEY_CHECKS=1;');

    console.log('');
    if (failed === 0) {
      console.log(chalk.green(`  ✔ Restore complete — ${restored} table${restored !== 1 ? 's' : ''} restored successfully.\n`));
    } else {
      console.log(chalk.yellow(`  ⚠ Restore finished with ${failed} error(s). ${restored} tables restored.\n`));
    }

  } finally {
    await conn.end().catch(() => {});
  }
}

/**
 * Split a SQL file into individual executable statements.
 * Handles multi-line INSERT batches and skips SET/comment lines safely.
 */
function splitStatements(sql) {
  const results = [];
  let current = '';
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const prev = sql[i - 1];

    if (!inString && (ch === "'" || ch === '"' || ch === '`')) {
      inString = true;
      stringChar = ch;
    } else if (inString && ch === stringChar && prev !== '\\') {
      inString = false;
    }

    current += ch;

    if (!inString && ch === ';') {
      const stmt = current.trim();
      if (stmt && !stmt.startsWith('--') && !stmt.startsWith('/*')) {
        results.push(stmt);
      }
      current = '';
    }
  }

  if (current.trim()) results.push(current.trim());
  return results;
}

function validateRestoreOpts(opts) {
  const errors = [];
  if (!opts.user) errors.push('--user is required');
  if (!opts.database) errors.push('--database is required');
  if (!opts.input) errors.push('--input (backup folder path) is required');
  return errors;
}

module.exports = { runRestore };
