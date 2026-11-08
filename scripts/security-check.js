// Scan the current index's file list, never database contents or Git history.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const paths = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const patterns = [
  /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /github_pat_[A-Za-z0-9_]{40,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
let failed = false;
for (const file of paths) {
  if (
    /(?:\.db|\.sqlite3?)(?:-(?:wal|shm|journal))?$|\.(?:wal|shm)$|(?:^|\/)\.env(?:\.|$)/i.test(
      file,
    ) &&
    !file.endsWith(".env.example")
  ) {
    console.error(`Forbidden tracked data/secret file: ${file}`);
    failed = true;
    continue;
  }
  if (!fs.existsSync(file)) continue;
  const data = fs.readFileSync(file);
  if (data.includes(0)) continue;
  if (patterns.some((p) => p.test(data.toString("utf8")))) {
    console.error(`Possible credential in: ${file}`);
    failed = true;
  }
}
if (failed) process.exitCode = 1;
else
  console.log(
    "Current tracked files pass database/secret-pattern checks. Historical data is not scanned.",
  );
