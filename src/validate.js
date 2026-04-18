'use strict';

function validateBackupOpts(opts) {
  const errors = [];
  if (!opts.user) errors.push('--user <username> is required');
  if (!opts.database) errors.push('--database <name> is required');
  if (!opts.output) errors.push('--output <folder> is required');
  if (opts.port && isNaN(parseInt(opts.port, 10))) errors.push('--port must be a number');
  return errors;
}

function validateRestoreOpts(opts) {
  const errors = [];
  if (!opts.user) errors.push('--user is required');
  if (!opts.database) errors.push('--database is required');
  if (!opts.input) errors.push('--input (backup folder path) is required');
  return errors;
}

module.exports = { validateBackupOpts, validateRestoreOpts };
