// PM2 ecosystem config — runs TypeScript directly via Node + tsx ESM loader
// No build step. pm2 restart works properly (Node process managed directly)
const BASE = "/home/ham/csi/stok opname/backend";
const TSX = `${BASE}/node_modules/.pnpm/tsx@4.22.2/node_modules/tsx/dist`;

module.exports = {
  apps: [
    {
      name: "stok-opname-backend",
      script: `${BASE}/index.ts`,
      cwd: BASE,
      interpreter: "/home/ham/.nvm/versions/node/v20.19.4/bin/node",
      interpreter_args: [
        `--require ${TSX}/preflight.cjs`,
        `--import file://${TSX}/loader.mjs`,
      ].join(" "),
      watch: false,
      kill_timeout: 5000,        // wait 5s before force-kill on restart
      listen_timeout: 10000,
      env: {
        NODE_ENV: "development",
      },
      error_file: "/home/ham/.pm2/logs/stok-opname-backend-error.log",
      out_file: "/home/ham/.pm2/logs/stok-opname-backend-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
