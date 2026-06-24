/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep server-only secrets out of the client bundle. All cookie/Apify/OpenRouter
  // handling happens in server routes; nothing sensitive is exposed via NEXT_PUBLIC_*.
};

export default nextConfig;
