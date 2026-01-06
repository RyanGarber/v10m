module.exports = {
  apps: [
    {
      name: 'v10m-web',
      script: 'node',
      args: '--import tsx ./src/apps/web/index.ts',
      interpreter: 'none',
    },
  ],
};
