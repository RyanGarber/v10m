module.exports = {
  apps: [
    {
      name: 'v10m-web',
      script: './dist/apps/web/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
    },
  ],
};
