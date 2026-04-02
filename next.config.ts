import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  outputFileTracingExcludes: {
    '*': [
      '**/.agent_venv/**',
      '**/environment_files/**',
      '**/tmp/**',
    ],
  },
  // discord.js, @discordjs/* and their optional native addons (zlib-sync, erlpack, sodium, etc.)
  // are Node.js-only packages. They must NOT be bundled by the browser-side webpack/SWC.
  // Marking them as server externals tells Next.js to require() them at runtime on the server
  // instead of bundling them, which eliminates the "Module not found: Can't resolve 'zlib-sync'" errors.
  serverExternalPackages: [
    'discord.js',
    '@discordjs/voice',
    '@discordjs/ws',
    '@discordjs/rest',
    '@discordjs/builders',
    '@discordjs/collection',
    'zlib-sync',
    'erlpack',
    'sodium',
    'libsodium-wrappers',
    '@sodium-native/core',
    'tweetnacl',
    'ffmpeg-static',
    'prism-media',
    'opusscript',
    '@distube/ytdl-core',
    'ytdl-core',
    'miniget',
  ],
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
  ],
};

export default nextConfig;
