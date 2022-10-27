---
description: Learn more about the switchable runtimes (Edge and Node.js) in Next.js.
---

# Edge and Node.js Runtimes

Next.js has two **server runtimes** where you can render parts of your application code: the **Node.js Runtime** and the [**Edge Runtime**](/docs/api-reference/edge-runtime.md). Depending on your deployment infrastructure, both runtimes support streaming.

By default, Next.js uses the Node.js runtime. [Middleware](https://nextjs.org/docs/advanced-features/middleware) and [Edge API Routes](https://nextjs.org/docs/api-routes/edge-api-routes) use the Edge runtime.

## Global Runtime Option

To configure the runtime for your whole application, you can set the experimental option `runtime` in your `next.config.js` file:

```js
// next.config.js
module.exports = {
  experimental: {
    runtime: 'experimental-edge', // 'node.js' (default) | experimental-edge
  },
}
```

You can detect which runtime you're using by looking at the `process.env.NEXT_RUNTIME` Environment Variable during runtime, and examining the `options.nextRuntime` variable during compilation.

## Page Runtime Option

On each page, you can optionally export a `runtime` config set to either `'nodejs'` or `'experimental-edge'`:

```jsx
// pages/index.js
export default function Index () { ... }

export function getServerSideProps() { ... }

export const config = {
  runtime: 'experimental-edge',
}
```

When both the per-page runtime and global runtime are set, the per-page runtime overrides the global runtime. If the per-page runtime is _not_ set, the global runtime option will be used.

## Runtime Differences

|                                                                                                                                                     | Node (Server) | Node (Serverless) | Edge             |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ----------------- | ---------------- |
| [Cold Boot](https://vercel.com/docs/concepts/get-started/compute#cold-and-hot-boots?utm_source=next-site&utm_medium=docs&utm_campaign=next-website) | /             | ~250ms            | Instant          |
| HTTP Streaming                                                                                                                                      | Yes           | Yes               | Yes              |
| IO                                                                                                                                                  | All           | All               | `fetch`          |
| Scalability                                                                                                                                         | /             | High              | Highest          |
| Security                                                                                                                                            | Normal        | High              | High             |
| Latency                                                                                                                                             | Normal        | Low               | Lowest           |
| Code Size                                                                                                                                           | /             | 50MB              | 1MB              |
| NPM Packages                                                                                                                                        | All           | All               | A smaller subset |

Next.js' default runtime configuration is good for most use cases, but there’re still many reasons to change to one runtime over the other one.

For example, for API routes that rely on native Node.js APIs, they need to run with the Node.js Runtime. However, if an API only uses something like cookie-based authentication, using Middleware and the Edge Runtime will be a better choice due to its lower latency as well as better scalability.

## Edge API Routes

[Edge API Routes](/docs/api-routes/edge-api-routes.md) enable you to build high performance APIs with Next.js using the Edge Runtime.

```typescript
export const config = {
  runtime: 'experimental-edge',
}

export default (req) => new Response('Hello world!')
```

## Related

<div class="card">
  <a href="/docs/api-reference/edge-runtime.md">
    <b>Edge Runtime</b>
    <small>Learn more about the supported Web APIs available.</small>
  </a>
</div>

<div class="card">
  <a href="/docs/api-reference/next/server.md">
    <b>Middleware API Reference</b>
    <small>Learn more about the supported APIs for Middleware.</small>
  </a>
</div>

<div class="card">
  <a href="/docs/api-routes/edge-api-routes.md">
    <b>Edge API Routes</b>
    <small>Build high performance APIs in Next.js. </small>
  </a>
</div>
