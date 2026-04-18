#!/usr/bin/env node

'use strict';

const { program } = require('commander');
const chalk = require('chalk');
const { runBackup } = require('../src/backup');
const { runRestore } = require('../src/restore');
const { interactivePrompt } = require('../src/prompt');
const pkg = require('../package.json');

const banner = `
${chalk.green('╔══════════════════════════════════════╗')}
${chalk.green('║')}  ${chalk.bold.white('DBBackup CLI')} ${chalk.gray('v' + pkg.version)}              ${chalk.green('║')}
${chalk.green('║')}  ${chalk.gray('MySQL database backup utility')}         ${chalk.green('║')}
${chalk.green('╚══════════════════════════════════════╝')}
`;

program
  .name('dbbackup')
  .description('CLI utility to backup and restore MySQL databases')
  .version(pkg.version);

program
  .command('backup')
  .description('Backup an entire database to SQL dump files')
  .option('-h, --host <host>', 'Database host', 'localhost')
  .option('-P, --port <port>', 'Database port', '3306')
  .option('-u, --user <username>', 'Database username')
  .option('-p, --password <password>', 'Database password')
  .option('-d, --database <name>', 'Database name to backup')
  .option('-o, --output <folder>', 'Destination folder for dump files', './backups')
  .option('--no-zip', 'Skip zipping the output folder')
  .option('--no-data', 'Backup schema only (no row data)')
  .option('--no-schema', 'Backup data only (no CREATE TABLE statements)')
  .option('--tables <tables>', 'Comma-separated list of specific tables to backup')
  .option('--env <file>', 'Load connection config from .env file')
  .action(async (opts) => {
    console.log(banner);
    try {
      await runBackup(opts);
    } catch (err) {
      console.error(chalk.red('\n✖ Fatal error: ') + err.message);
      process.exit(1);
    }
  });

program
  .command('restore')
  .description('Restore a database from a backup folder or zip')
  .option('-h, --host <host>', 'Database host', 'localhost')
  .option('-P, --port <port>', 'Database port', '3306')
  .option('-u, --user <username>', 'Database username')
  .option('-p, --password <password>', 'Database password')
  .option('-d, --database <name>', 'Target database name')
  .option('-i, --input <folder>', 'Source folder or zip file containing dump files')
  .option('--drop', 'Drop and recreate tables before restoring')
  .action(async (opts) => {
    console.log(banner);
    try {
      await runRestore(opts);
    } catch (err) {
      console.error(chalk.red('\n✖ Fatal error: ') + err.message);
      process.exit(1);
    }
  });

program
  .command('interactive')
  .alias('i')
  .description('Launch interactive guided backup wizard')
  .action(async () => {
    console.log(banner);
    try {
      await interactivePrompt();
    } catch (err) {
      console.error(chalk.red('\n✖ Fatal error: ') + err.message);
      process.exit(1);
    }
  });

program.addHelpText('after', `
${chalk.bold('Examples:')}
  ${chalk.cyan('$ dbbackup backup -h localhost -u root -p secret -d mydb -o ./dumps')}
  ${chalk.cyan('$ dbbackup backup -h db.example.com -u admin -p pass -d shop --tables orders,products')}
  ${chalk.cyan('$ dbbackup restore -h localhost -u root -p secret -d mydb -i ./dumps/mydb_2024-01-15 --drop')}
  ${chalk.cyan('$ dbbackup interactive')}
`);

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  console.log(banner);
  program.outputHelp();
}
