/** @type {import('next').NextConfig} */
const path = require('path');

const nextConfig = {
  transpilePackages: ['@sangati/shared'],
  reactStrictMode: true,
  output: 'standalone',
  experimental: {
    // In a pnpm monorepo node_modules are hoisted to the workspace root.
    // Without this Next.js can't trace them and standalone/node_modules ends
    // up empty — causing "Cannot find module 'next'" at runtime.
    outputFileTracingRoot: path.join(__dirname, '../../'),
  },
};

module.exports = nextConfig;
