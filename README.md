# DBBackup CLI

A Node.js command-line utility to **backup and restore MySQL databases**.
Connects to any MySQL server, pulls every table's schema and data, and
writes self-contained `.sql` dump files you can use to restore the database
on any other server.

---

## Features

- Per-table `.sql` dump files (schema + batched `INSERT` statements)
- Master `_restore_all.sql` that sources every table file in order
- JSON manifest with metadata (rows, file sizes, duration)
- Optional `.zip` compression of the entire backup folder
- Selective backup with `--tables`
- Schema-only or data-only modes
- Interactive wizard mode for non-technical users
- Restore command with `--drop` support
- Friendly error messages for common failures (wrong password, host not found, etc.)

---

## Installation

```bash
npm install
chmod +x bin/dbbackup.js
npm link          # makes `dbbackup` available globally
```

Or run directly without installing globally:
```bash
node bin/dbbackup.js backup [options]
```

---

## Commands

### `backup` — Backup a database

```
dbbackup backup [options]

Options:
  -h, --host <host>          Database host           (default: localhost)
  -P, --port <port>          Database port           (default: 3306)
  -u, --user <username>      Database username       (required)
  -p, --password <password>  Database password
  -d, --database <name>      Database name           (required)
  -o, --output <folder>      Destination folder      (default: ./backups)
      --no-zip               Skip zip compression
      --no-data              Schema only (no INSERT rows)
      --no-schema            Data only (no CREATE TABLE)
      --tables <t1,t2>       Only backup specific tables
```

**Examples:**

```bash
# Full backup to ./backups
dbbackup backup -h localhost -u root -p secret -d mydb -o ./backups

# Remote host, specific tables only
dbbackup backup -h db.prod.example.com -u admin -p pass -d shop \
  --tables orders,products,customers -o ./dumps

# Schema only (no data rows)
dbbackup backup -h localhost -u root -p pass -d mydb --no-data

# Skip zip compression
dbbackup backup -h localhost -u root -p pass -d mydb --no-zip
```

---

### `restore` — Restore a database

```
dbbackup restore [options]

Options:
  -h, --host <host>          Database host           (default: localhost)
  -P, --port <port>          Database port           (default: 3306)
  -u, --user <username>      Database username       (required)
  -p, --password <password>  Database password
  -d, --database <name>      Target database name    (required)
  -i, --input <folder>       Backup folder path      (required)
      --drop                 DROP tables before restoring
```

**Examples:**

```bash
# Restore from a backup folder
dbbackup restore -h localhost -u root -p secret -d mydb \
  -i ./backups/mydb_2024-01-15T10-30-00

# Drop and recreate tables before restoring
dbbackup restore -h localhost -u root -p secret -d mydb_restored \
  -i ./backups/mydb_2024-01-15T10-30-00 --drop
```

**Alternatively, restore manually with `mysql`:**
```bash
mysql -h localhost -u root -p mydb < ./backups/mydb_2024-01-15T10-30-00/_restore_all.sql
```

---

### `interactive` — Guided wizard

Walks you through all options interactively:

```bash
dbbackup interactive
# or
dbbackup i
```

---

## Output Structure

Each backup creates a timestamped folder:

```
backups/
└── mydb_2024-01-15T10-30-00/
    ├── _manifest.json          ← metadata (tables, rows, duration)
    ├── _restore_all.sql        ← master script — SOURCE all table files
    ├── users.sql               ← CREATE TABLE + INSERT rows
    ├── products.sql
    ├── orders.sql
    └── order_items.sql
backups/
└── mydb_2024-01-15T10-30-00.zip   ← compressed archive (unless --no-zip)
```

### Table dump format

Each `.sql` file is self-contained and idempotent:

```sql
-- DataPull DB Backup — Table: `users`
-- Generated: 2024-01-15T10:30:00.000Z
-- Rows: 4218

SET FOREIGN_KEY_CHECKS=0;

-- Table structure
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(255) NOT NULL,
  `created_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table data — 4,218 rows
INSERT INTO `users` (`id`, `email`, `created_at`) VALUES
  (1, 'alice@example.com', '2023-06-01 09:00:00'),
  (2, 'bob@example.com', '2023-06-02 14:22:00'),
  ...;

SET FOREIGN_KEY_CHECKS=1;
```

---

## Manifest File

`_manifest.json` records backup metadata:

```json
{
  "tool": "dbbackup-cli",
  "version": "1.0.0",
  "backup": {
    "database": "mydb",
    "host": "localhost",
    "startedAt": "2024-01-15T10:30:00.000Z",
    "completedAt": "2024-01-15T10:30:42.000Z",
    "durationMs": 42000,
    "tables": [
      { "name": "users", "rows": 4218, "fileSizeBytes": 312400 },
      { "name": "products", "rows": 850, "fileSizeBytes": 98200 }
    ],
    "totalTables": 2,
    "totalRows": 5068
  }
}
```

---

## Requirements

- Node.js >= 14.0.0
- MySQL 5.7+ or MySQL 8+
- The database user must have `SELECT`, `SHOW DATABASES`, and `SHOW CREATE TABLE` privileges

### Grant minimum privileges:
```sql
GRANT SELECT, SHOW DATABASES ON mydb.* TO 'backup_user'@'localhost';
FLUSH PRIVILEGES;
```

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| Connection refused | MySQL not running or wrong port | Check `mysqld` status and port |
| Access denied | Wrong credentials | Verify username/password |
| Host not found | Hostname can't resolve | Check DNS or use IP address |
| ER_BAD_DB_ERROR | Database doesn't exist | Check database name spelling |
| Empty backup | No tables in database | Verify you're targeting the right database |
