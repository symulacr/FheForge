import withBundleAnalyzer from '@next/bundle-analyzer';

/** @type {import('next').NextConfig} */
const nextConfig = {
  swcMinify: true,
  experimental: {
    optimizePackageImports: [
      'lucide-react', 'framer-motion',
      '@radix-ui/react-accordion', '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu', '@radix-ui/react-tabs',
      '@radix-ui/react-select', '@radix-ui/react-tooltip',
      '@radix-ui/react-popover', '@radix-ui/react-toast',
    ],
  },
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
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
  images: {
    // Enable Next.js built-in image optimization
    unoptimized: false,
    // Security: restrict remote image patterns to known, trusted sources
  },
  webpack: (config, { dev, isServer }) => {
    if (!dev && !isServer) {
      // Explicitly disable embedded source maps for production
      // eval-source-map is dev-only; productionBrowserSourceMaps is already false
      config.devtool = false
    }
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false, net: false, tls: false, crypto: false,
        path: false, os: false, stream: false, buffer: false, node: false,
      };
    }
    if (config.optimization?.splitChunks?.cacheGroups) {
      config.optimization.splitChunks.cacheGroups.wagmi = {
        test: /[\\/]node_modules[\\/](wagmi|viem|@wagmi|@tanstack|ethers|@ethersproject|cofhe)[\\/]/,
        name: 'vendor-wagmi',
        chunks: 'all',
        priority: 20,
      }
      config.optimization.splitChunks.cacheGroups.ui = {
        test: /[\\/]node_modules[\\/](reactflow|framer-motion|lucide-react|@radix-ui)[\\/]/,
        name: 'vendor-ui',
        chunks: 'all',
        priority: 10,
      }
    }
    return config;
  },
};

export default process.env.ANALYZE === 'true'
  ? withBundleAnalyzer({
      openAnalyzer: true,
    })(nextConfig)
  : nextConfig;
