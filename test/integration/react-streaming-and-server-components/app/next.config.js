const withReact18 = require('../../react-18/test/with-react-18')

module.exports = withReact18({
  onDemandEntries: {
    maxInactiveAge: 1000 * 60 * 60,
  },
  pageExtensions: ['js', 'ts', 'jsx'], // .tsx won't be treat as page,
  experimental: {
    reactRoot: true,
    concurrentFeatures: true,
    serverComponents: true,
  },
})
