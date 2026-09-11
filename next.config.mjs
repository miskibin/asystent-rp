/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  transpilePackages: [
    "streamdown",
    "@streamdown/code",
    "@streamdown/mermaid",
    "@streamdown/math",
    "mermaid",
  ],
};

export default nextConfig;
