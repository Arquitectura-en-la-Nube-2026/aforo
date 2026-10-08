import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image (apps/web/Dockerfile).
  output: 'standalone',
  // Monorepo: trace dependencies hoisted to the repo root `node_modules`.
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
  poweredByHeader: false,
};

export default nextConfig;
