import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  allowedDevOrigins: ["192.168.68.67", "192.168.1.0/24", "localhost"],
};

export default nextConfig;
