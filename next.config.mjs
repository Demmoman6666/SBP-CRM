/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  async redirects() {
    return [
      // Redirect old path to the new one
      { source: "/sales-hub", destination: "/saleshub", permanent: true },
      { source: "/sales-hub/:path*", destination: "/saleshub/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
