/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // Production: browser talks to same origin (/api/*) so session cookies work.
    // Set API_PROXY_TARGET=https://tracefix.onrender.com on Vercel.
    const target = process.env.API_PROXY_TARGET || process.env.NEXT_PUBLIC_API_PROXY_TARGET;
    if (!target) return [];
    const base = target.replace(/\/$/, '');
    return [
      {
        source: '/api/:path*',
        destination: `${base}/:path*`,
      },
    ];
  },
};

export default nextConfig;
