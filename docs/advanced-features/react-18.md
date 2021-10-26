# React 18

[React 18](https://reactjs.org/blog/2021/06/08/the-plan-for-react-18.html) adds new features including, Suspense, automatic batching of updates, APIs like `startTransition`, and a new streaming API for server rendering with support for `React.lazy`.

React 18 is still in alpha. Read more about React 18's [release plan](https://github.com/reactwg/react-18/discussions) and discussions from the [working group](https://github.com/reactwg/react-18/discussions).

### React 18 Usage in Next.js

Ensure you have the `alpha` version of React installed:

```jsx
npm install next@latest react@alpha react-dom@alpha
```

### Enable SSR Streaming (Alpha)

Concurrent features in React 18 include built-in support for server-side Suspense and SSR streaming support, allowing you to server-render pages using HTTP streaming.

This is an experimental feature in Next.js 12, but once enabled, SSR will use the same [Edge Runtime](/docs/api-reference/edge-runtime.md) as [Middleware](/docs/middleware.md).

To enable, use the experimental flag `concurrentFeatures: true`:

```jsx
// next.config.js
module.exports = {
  experimental: {
    concurrentFeatures: true,
  },
}
```

Once enabled, you can use Suspense and SSR streaming for all pages. This also means that you can use Suspense-based data-fetching, `next/dynamic`, and React's built-in `React.lazy` with Suspense boundaries.

```jsx
import dynamic from 'next/dynamic'
import { lazy } from 'react'

import Content from '../components/content'

// These two ways are identical:
const Profile = dynamic(() => import('./profile'), { suspense: true })
const Footer = lazy(() => import('./footer'))

export default function Home() {
  return (
    <div>
      <Suspense fallback={<Spinner />}>
        {/* A component that uses Suspense-based */}
        <Content />
      <Suspense>
      <Suspense fallback={<Spinner />}>
        <Profile />
      </Suspense>
      <Suspense fallback={<Spinner />}>
        <Footer />
      </Suspense>
    </div>
  )
}
```

## React Server Components

React Server Components allow us to render everything, including the components themselves, on the server. This is fundamentally different from server-side rendering where you're pre-generating HTML on the server. With Server Components, there's **zero client-side JavaScript needed,** making page rendering faster. This improves the user experience of your application, pairing the best parts of server-rendering with client-side interactivity.

### Enable React Server Components (Alpha)

To use React Server Components, ensure you have React 18 installed. Then, turn on the `currentFeatures` and `serverComponents` options in `next.config.js`:

```jsx
// next.config.js
module.exports = {
  experimental: {
    concurrentFeatures: true,
    serverComponents: true,
  },
}
```

Next, you need to customize your `pages/_document` component to be a functional component by removing any static methods like `getInitialProps` or exports like `getServerSideProps`

```jsx
// pages/_document.js
import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html>
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
```

Then, you can start using React Server Components. [See our example](https://github.com/vercel/next-rsc-demo) for more information.

### Server Components APIs (Alpha)

To run a component on the server, append `.server.js` to the end of the filename. For example `./pages/home.server.js` is a Server Component.

For client components, add `.client.js`. For example, `./components/avatar.client.js`.

You can then import other server or client components from any server component. Note: a server component **can not** be imported by a client component. Components without "server/client" extensions will be treated as "universal component" and can be used and rendered by both sides, depending on where it is imported. For example:

```jsx
// pages/home.server.js

import React, { Suspense } from 'react'

import Profile from '../components/profile.server'
import Content from '../components/content.client'

export default function Home() {
  return (
    <div>
      <h1>Welcome to React Server Components</h1>
      <Suspense fallback={'Loading...'}>
        <Profile />
      </Suspense>
      <Content/>
    </div>
  )
}
```

The `<Home>` and `<Profile>` components will always be server-side rendered and streamed to the client, and will not be included by the client runtime. However `<Content>` will still be hydrated on the client-side, like normal React components.

To see a full example, check out [link to the demo and repository](https://github.com/vercel/next-rsc-demo).

## **Supported Next.js APIs**

- `next/link` / `next/image`
- `next/document` / `next/app`
- Dynamic routing

## **Unsupported Next.js APIs**

While RSC and SSR streaming is still in the alpha stage, not all Next.js APIs are supported. The following Next.js APIs have limited functionality inside Server Components:

- React internals: Most of React hooks such as `useContext`, `useState`, `useReducer`, `useEffect` and `useLayoutEffect` are not supported as of today since Server Components are executed per requests and aren't stateful.
- Partial: Note that Inside `.client.js` components `useRouter` is supported
- Styled JSX
- CSS Modules
- Next.js I18n
- `getInitialProps`, `getStaticProps` and `getStaticPaths`

React 18 without SSR streaming isn't affected.
