/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Packages that must NOT be bundled: native/WASM binaries (sharp, mupdf),
    // the Prisma engine, and parsers that read files at runtime (pdf-parse).
    serverComponentsExternalPackages: [
      '@prisma/client',
      'prisma',
      'bcryptjs',
      'sharp',
      'mupdf',
      'pdf-parse',
      'pdfjs-dist',
      'tesseract.js',
      '@zxing/library',
      'pdf-lib',
    ],
  },
};

export default nextConfig;
