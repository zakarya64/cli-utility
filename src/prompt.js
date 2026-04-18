'use strict';

const readline = require('readline');
const chalk = require('chalk');
const { runBackup } = require('./backup');

function ask(rl, question, defaultVal) {
  return new Promise(resolve => {
    const hint = defaultVal ? chalk.gray(` [${defaultVal}]`) : '';
    rl.question(`  ${question}${hint}: `, answer => {
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

function askYN(rl, question, defaultVal = true) {
  return new Promise(resolve => {
    const hint = chalk.gray(defaultVal ? ' [Y/n]' : ' [y/N]');
    rl.question(`  ${question}${hint}: `, answer => {
      const a = answer.trim().toLowerCase();
      if (!a) { resolve(defaultVal); return; }
      resolve(a === 'y' || a === 'yes');
    });
  });
}

async function interactivePrompt() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log(chalk.bold('  Backup Wizard\n'));
  console.log(chalk.gray('  Answer the prompts below. Press Enter to accept defaults.\n'));

  const host     = await ask(rl, 'Database host', 'localhost');
  const port     = await ask(rl, 'Database port', '3306');
  const user     = await ask(rl, 'Username', 'root');
  const password = await ask(rl, 'Password', '');
  const database = await ask(rl, 'Database name', '');
  const output   = await ask(rl, 'Output folder', './backups');
  const tables   = await ask(rl, 'Specific tables (comma-separated, or leave blank for all)', '');
  const schema   = await askYN(rl, 'Include schema (CREATE TABLE)?', true);
  const data     = await askYN(rl, 'Include data (INSERT rows)?', true);
  const zip      = await askYN(rl, 'Compress output to zip?', true);

  rl.close();
  console.log('');

  if (!database) {
    console.error(chalk.red('✖ Database name is required.'));
    process.exit(1);
  }

  await runBackup({ host, port, user, password, database, output, tables: tables || undefined, schema, data, zip });
}

module.exports = { interactivePrompt };
