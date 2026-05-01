import withBundleAnalyzer from '@next/bundle-analyzer';

/** @type {import('next').NextConfig} */
const nextConfig = {
  swcMinify: true,
  images: {
    // Enable Next.js built-in image optimization
    unoptimized: false,
    // List external image sources domains (empty by default; fill if you load from external sources)
    domains: [],
    // Security: restrict remote image patterns to known, trusted sources
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.yourdomain.com',
        pathname: '/images/**',
      },
    ],
  },
  webpack: (config, { isServer }) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false, net: false, tls: false, crypto: false,
        path: false, os: false, stream: false, buffer: false, node: false,
      };
    }
    return config;
  },
};

export default process.env.ANALYZE === 'true'
  ? withBundleAnalyzer({
      openAnalyzer: true,
    })(nextConfig)
  : nextConfig;
