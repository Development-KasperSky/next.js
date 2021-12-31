# No Head Element

### Why This Error Occurred

An HTML `<head>` element was used to include page-level metadata, but this can cause unexpected behavior in a Next.js application. Use Next.js' built-in `<Head />` component instead.

### Possible Ways to Fix It

Import and use the `<Head />` component:

```jsx
import Head from 'next/head'

function Index() {
  return (
    <>
      <Head>
        <title>My page title</title>
        <meta name="viewport" content="initial-scale=1.0, width=device-width" />
      </Head>
    </>
  )
}

export default Index
```

### Useful Links

- [next/head](https://nextjs.org/docs/api-reference/next/head)
