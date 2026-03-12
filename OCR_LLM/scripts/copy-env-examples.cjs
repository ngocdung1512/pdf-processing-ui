/**
 * Cross-platform copy of .env.example to .env (no overwrite).
 * Used by setup:envs on Windows where "cp -n" is not available.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pairs = [
  ["frontend/.env.example", "frontend/.env"],
  ["server/.env.example", "server/.env.development"],
  ["collector/.env.example", "collector/.env"],
  ["docker/.env.example", "docker/.env"],
];

for (const [src, dest] of pairs) {
  const srcPath = path.join(root, src);
  const destPath = path.join(root, dest);
  if (fs.existsSync(srcPath)) {
    if (!fs.existsSync(destPath)) {
      fs.copyFileSync(srcPath, destPath);
      console.log("Created:", dest);
    }
  }
}
console.log("All ENV files copied!");
