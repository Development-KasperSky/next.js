const mod = require('module')

const hookPropertyMap = new Map([
  ['react', 'react-18'],
  ['react/jsx-runtime', 'react-18/jsx-runtime'],
  ['react/jsx-dev-runtime', 'react-18/jsx-dev-runtime'],
  ['react-dom', 'react-dom-18'],
  ['react-dom/server', 'react-dom-18/server'],
  ['react-dom/server.browser', 'react-dom-18/server.browser'],
])

const resolveFilename = mod._resolveFilename
mod._resolveFilename = function (request, parent, isMain, options) {
  const hookResolved = hookPropertyMap.get(request)
  if (hookResolved) request = hookResolved
  return resolveFilename.call(mod, request, parent, isMain, options)
}
