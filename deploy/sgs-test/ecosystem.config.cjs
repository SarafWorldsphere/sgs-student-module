const path = require('node:path');
const root = path.resolve(__dirname, '../..');

module.exports = {
  apps: [
    {
      name: 'demo-student-api',
      cwd: path.join(root, 'backend'),
      script: path.join(root, 'backend/.venv/bin/python'),
      interpreter: 'none',
      args: '-m uvicorn main:app --host 127.0.0.1 --port 4109 --workers 1',
      env: { PYTHONUNBUFFERED: '1' },
      restart_delay: 3000,
    },
    {
      name: 'demo-student',
      cwd: root,
      script: path.join(root, 'node_modules/next/dist/bin/next'),
      interpreter: process.execPath,
      args: 'start --hostname 127.0.0.1 --port 4102',
      env: { NODE_ENV: 'production' },
      restart_delay: 3000,
    },
  ],
};
