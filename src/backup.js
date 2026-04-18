'use strict';

const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const ora = require('ora');
const archiver = require('archiver');
const Table = require('cli-table3');

const {
  createConnection,
  getTables,
  getTableSchema,
  getTableData,
  getColumnTypes,
  getDatabaseMeta,
  getForeignKeys,
} = require('./db');

const { writeTableDump, writeMasterDump, writeManifest } = require('./writer');
const { validateBackupOpts } = require('./validate');

/**
 * Main backup entry point.
 */
async function runBackup(opts) {
  // 1. Validate inputs
  const errors = validateBackupOpts(opts);
  if (errors.length) {
    console.error(chalk.red('\n✖ Missing required options:'));
    errors.forEach(e => console.error(chalk.red(`  • ${e}`)));
    console.error(chalk.gray('\nRun: dbbackup backup --help\n'));
    process.exit(1);
  }

  const startedAt = new Date().toISOString();
  const { database, host } = opts;

  // 2. Prepare output directory
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputDir = path.resolve(opts.output, `${database}_${timestamp}`);
  await fs.ensureDir(outputDir);

  console.log(chalk.bold('\n  Backup Configuration'));
  console.log(chalk.gray('  ─────────────────────────────────────'));
  console.log(`  ${chalk.gray('Host')}       ${chalk.white(host + ':' + (opts.port || 3306))}`);
  console.log(`  ${chalk.gray('User')}       ${chalk.white(opts.user)}`);
  console.log(`  ${chalk.gray('Database')}   ${chalk.white(database)}`);
  console.log(`  ${chalk.gray('Output')}     ${chalk.white(outputDir)}`);
  console.log(`  ${chalk.gray('Schema')}     ${chalk.white(opts.schema !== false ? 'yes' : 'no')}`);
  console.log(`  ${chalk.gray('Data')}       ${chalk.white(opts.data !== false ? 'yes' : 'no')}`);
  if (opts.tables) console.log(`  ${chalk.gray('Tables')}     ${chalk.white(opts.tables)}`);
  console.log('');

  // 3. Connect
  const connSpinner = ora('Connecting to database...').start();
  let conn;
  try {
    conn = await createConnection(opts);
    connSpinner.succeed(chalk.green('Connected to ') + chalk.bold(host));
  } catch (err) {
    connSpinner.fail(chalk.red('Connection failed: ') + err.message);
    process.exit(1);
  }

  try {
    // 4. Discover tables
    const tableSpinner = ora('Discovering tables...').start();
    let tables = await getTables(conn, database);

    if (opts.tables) {
      const filter = opts.tables.split(',').map(t => t.trim());
      tables = tables.filter(t => filter.includes(t));
      if (!tables.length) {
        tableSpinner.fail('None of the specified tables were found in the database.');
        process.exit(1);
      }
    }

    if (!tables.length) {
      tableSpinner.warn('No tables found in database — nothing to backup.');
      process.exit(0);
    }

    tableSpinner.succeed(`Found ${chalk.bold(tables.length)} table${tables.length !== 1 ? 's' : ''}`);

    // 5. Fetch database metadata
    const meta = await getDatabaseMeta(conn, database);

    // 6. Backup each table
    console.log('');
    const results = [];
    let totalRows = 0;

    for (let i = 0; i < tables.length; i++) {
      const table = tables[i];
      const idx = chalk.gray(`[${String(i + 1).padStart(String(tables.length).length)}/${tables.length}]`);
      const spinner = ora(`${idx} Backing up ${chalk.cyan(table)}...`).start();

      try {
        const [schema, rows, columnTypes] = await Promise.all([
          opts.schema !== false ? getTableSchema(conn, table) : Promise.resolve(''),
          opts.data !== false ? getTableData(conn, table) : Promise.resolve([]),
          getColumnTypes(conn, database, table),
        ]);

        const filePath = await writeTableDump({
          outputDir,
          database,
          table,
          schema,
          rows,
          columnTypes,
          includeSchema: opts.schema !== false,
          includeData: opts.data !== false,
        });

        const stat = await fs.stat(filePath);
        const kb = (stat.size / 1024).toFixed(1);
        totalRows += rows.length;

        results.push({ name: table, rows: rows.length, fileSizeBytes: stat.size });

        spinner.succeed(
          `${idx} ${chalk.cyan(table.padEnd(30))} ` +
          chalk.gray(`${rows.length.toLocaleString()} rows`) +
          chalk.gray(` • ${kb} KB`)
        );
      } catch (err) {
        spinner.fail(`${idx} ${chalk.cyan(table)} — ${chalk.red(err.message)}`);
        results.push({ name: table, rows: 0, fileSizeBytes: 0, error: err.message });
      }
    }

    // 7. Write master restore script and manifest
    console.log('');
    const masterSpinner = ora('Writing master restore script...').start();
    await writeMasterDump({
      outputDir,
      database,
      tables,
      meta,
      includeSchema: opts.schema !== false,
      includeData: opts.data !== false,
    });
    masterSpinner.succeed('Master restore script written → ' + chalk.cyan('_restore_all.sql'));

    const completedAt = new Date().toISOString();
    await writeManifest({
      outputDir,
      database,
      host,
      tables: results,
      totalRows,
      startedAt,
      completedAt,
    });

    // 8. Zip if requested
    if (opts.zip !== false) {
      const zipSpinner = ora('Compressing backup...').start();
      const zipPath = outputDir + '.zip';
      await zipDirectory(outputDir, zipPath);
      const zipStat = await fs.stat(zipPath);
      const zipMB = (zipStat.size / 1024 / 1024).toFixed(2);
      zipSpinner.succeed(`Compressed → ${chalk.cyan(path.basename(zipPath))} (${zipMB} MB)`);
    }

    // 9. Summary table
    printSummary(results, outputDir, totalRows, startedAt, completedAt);

  } finally {
    await conn.end().catch(() => {});
  }
}

function printSummary(results, outputDir, totalRows, startedAt, completedAt) {
  const durationMs = new Date(completedAt) - new Date(startedAt);
  const failed = results.filter(r => r.error);
  const succeeded = results.filter(r => !r.error);

  console.log('\n' + chalk.bold('  Backup Summary'));
  console.log(chalk.gray('  ─────────────────────────────────────'));

  const table = new Table({
    head: [
      chalk.gray('Table'),
      chalk.gray('Rows'),
      chalk.gray('Size'),
      chalk.gray('Status'),
    ],
    style: { border: ['gray'], head: [] },
    colWidths: [35, 12, 12, 12],
  });

  results.forEach(r => {
    table.push([
      r.name,
      r.rows.toLocaleString(),
      r.fileSizeBytes ? (r.fileSizeBytes / 1024).toFixed(1) + ' KB' : '-',
      r.error ? chalk.red('✖ Failed') : chalk.green('✔ OK'),
    ]);
  });

  console.log(table.toString());
  console.log('');
  console.log(`  ${chalk.gray('Tables')}     ${chalk.white(results.length)} (${chalk.green(succeeded.length + ' ok')}${failed.length ? ', ' + chalk.red(failed.length + ' failed') : ''})`);
  console.log(`  ${chalk.gray('Total rows')} ${chalk.white(totalRows.toLocaleString())}`);
  console.log(`  ${chalk.gray('Duration')}   ${chalk.white(durationMs + 'ms')}`);
  console.log(`  ${chalk.gray('Output')}     ${chalk.cyan(outputDir)}`);
  console.log('');

  if (failed.length) {
    console.log(chalk.yellow(`  ⚠ ${failed.length} table(s) failed. Check errors above.`));
  } else {
    console.log(chalk.green('  ✔ Backup completed successfully.'));
    console.log(chalk.gray(`\n  To restore, run:`));
    console.log(chalk.cyan(`  mysql -h <host> -u <user> -p <database> < ${outputDir}/_restore_all.sql\n`));
  }
}

function zipDirectory(sourceDir, outPath) {
  return new Promise((resolve, reject) => {
    const output = require('fs').createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, path.basename(sourceDir));
    archive.finalize();
  });
}

module.exports = { runBackup };
