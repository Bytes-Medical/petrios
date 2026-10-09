/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Session-document uploads are authenticated and server-validated. Keep
    // this just above the database/storage 25 MiB limit for multipart framing.
    serverActions: { bodySizeLimit: '26mb' },
  },
  // Self-contained server bundle for the Docker image (docs/self-hosting.md).
  output: 'standalone',
}

module.exports = nextConfig
