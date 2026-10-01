/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");

module.exports = {
  apps: [
    {
      name: "modon-school",
      cwd: __dirname,
      script: path.join(__dirname, "node_modules", "next", "dist", "bin", "next"),
      args: "start --hostname 127.0.0.1 --port 3003",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "1G",
      watch: false,
      out_file: path.join(__dirname, "logs", "modon-app.out.log"),
      error_file: path.join(__dirname, "logs", "modon-app.error.log"),
      merge_logs: true,
      time: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      env: {
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
        PORT: "3003",
        APP_URL: "https://modon-school.com",
        // Passed through from the deploy environment when set; the app falls
        // back to Upstash / in-memory rate limiting when it is empty.
        ...(process.env.REDIS_URL ? { REDIS_URL: process.env.REDIS_URL } : {}),
      },
    },
  ],
};
