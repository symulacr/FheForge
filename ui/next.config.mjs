import withBundleAnalyzer from '@next/bundle-analyzer';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: new URL('..', import.meta.url).pathname,
  experimental: {
    optimizePackageImports: [
      'lucide-react', 'framer-motion',
      '@radix-ui/react-accordion', '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu', '@radix-ui/react-tabs',
      '@radix-ui/react-select', '@radix-ui/react-tooltip',
      '@radix-ui/react-popover', '@radix-ui/react-toast',
    ],
  },
  // Add empty turbopack config to silence the webpack migration warning
  turbopack: {},
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "credentialless",
          },
        ],
      },
    ];
  },
  images: {
    unoptimized: false,
  },
};

export default process.env.ANALYZE === 'true'
  ? withBundleAnalyzer({
      openAnalyzer: true,
    })(nextConfig)
  : nextConfig;
