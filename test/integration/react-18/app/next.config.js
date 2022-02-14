const withReact18 = require('../test/with-react-18')

module.exports = withReact18({
  // reactStrictMode: true,
  experimental: {
    reactRoot: true,
    // runtime: 'edge',
  },
  images: {
    deviceSizes: [480, 1024, 1600, 2000],
    imageSizes: [16, 32, 48, 64],
    path: 'https://example.com/myaccount/',
    loader: 'imgix',
  },
})
