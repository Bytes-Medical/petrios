/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for the Docker image (docs/self-hosting.md).
  output: 'standalone',
}

module.exports = nextConfig
