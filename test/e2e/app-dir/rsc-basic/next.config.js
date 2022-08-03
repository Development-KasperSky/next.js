module.exports = {
  reactStrictMode: true,
  onDemandEntries: {
    maxInactiveAge: 1000 * 60 * 60,
  },
  experimental: {
    appDir: true,
    serverComponents: true,
  },
}
