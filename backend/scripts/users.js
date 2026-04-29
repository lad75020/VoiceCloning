import { pbkdf2Sync, randomBytes, randomUUID } from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_DIR = path.join(__dirname, '..');
const DB_PATH = process.env.AUTH_DB_PATH || path.join(BACKEND_DIR, 'data', 'auth.sqlite');

const [, , command, ...args] = process.argv;

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS auth_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const hash = pbkdf2Sync(String(password), salt, 210_000, 32, 'sha256').toString('base64url');
  return `pbkdf2_sha256$210000$${salt}$${hash}`;
}

function usage(exitCode = 1) {
  console.log(`Usage:
  npm run user:add -- <username> <password>
  npm run user:delete -- <username>
  npm run user:list

Environment:
  AUTH_DB_PATH  Override SQLite DB path. Default: ${DB_PATH}
`);
  process.exit(exitCode);
}

function requireArg(value, name) {
  if (!value || !String(value).trim()) {
    console.error(`${name} is required.`);
    usage();
  }
  return String(value).trim();
}

function addUser(username, password) {
  const now = new Date().toISOString();
  try {
    db.prepare(`
      INSERT INTO users (id, username, password_hash, created_at)
      VALUES (?, ?, ?, ?)
    `).run(randomUUID(), username, hashPassword(password), now);
  } catch (err) {
    if (String(err?.message || '').includes('UNIQUE')) {
      console.error(`User "${username}" already exists.`);
      process.exit(1);
    }
    throw err;
  }

  console.log(`Inserted user "${username}" into ${DB_PATH}`);
}

function deleteUser(username) {
  const result = db.prepare('DELETE FROM users WHERE username = ?').run(username);
  if (result.changes === 0) {
    console.log(`No user named "${username}" found in ${DB_PATH}`);
    return;
  }
  console.log(`Deleted user "${username}" and their sessions from ${DB_PATH}`);
}

function listUsers() {
  const users = db.prepare(`
    SELECT
      users.username,
      users.created_at,
      COUNT(sessions.id) AS session_count
    FROM users
    LEFT JOIN sessions ON sessions.user_id = users.id AND sessions.revoked_at IS NULL
    GROUP BY users.id
    ORDER BY users.username
  `).all();

  if (!users.length) {
    console.log(`No users found in ${DB_PATH}`);
    return;
  }

  for (const user of users) {
    console.log(`${user.username}\tcreated=${user.created_at}\tactive_sessions=${user.session_count}`);
  }
}

if (command === 'add') {
  addUser(requireArg(args[0], 'username'), requireArg(args[1], 'password'));
} else if (command === 'delete') {
  deleteUser(requireArg(args[0], 'username'));
} else if (command === 'list') {
  listUsers();
} else {
  usage(command === '--help' || command === '-h' ? 0 : 1);
}
