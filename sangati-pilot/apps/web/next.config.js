/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@sangati/shared'],
  reactStrictMode: true,
  output: 'standalone',
};

module.exports = nextConfig;
