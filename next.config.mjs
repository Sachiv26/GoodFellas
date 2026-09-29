/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Packages that must NOT be bundled: native/WASM binaries (sharp, mupdf),
    // the Prisma engine, and packages that read files at runtime. Anything
    // listed here is kept OUT of the server bundle. Note: there is deliberately
    // no OCR/AI engine in this list — the licence disc barcode (ZXing) is the
    // only document data source.
    serverComponentsExternalPackages: [
      '@prisma/client',
      'prisma',
      'bcryptjs',
      'sharp',
      'mupdf',
      'pdfjs-dist',
      '@zxing/library',
      'pdf-lib',
    ],
  },
};

export default nextConfig;
