/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: [],
    unoptimized: true, // Allow base64-encoded images
  },
};

module.exports = nextConfig;
