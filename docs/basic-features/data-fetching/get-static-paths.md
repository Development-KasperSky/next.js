---
description: Fetch data and generate static pages with `getStaticProps`. Learn more about this API for data fetching in Next.js.
---

# getStaticPaths

If a page has [Dynamic Routes](/docs/routing/dynamic-routes.md) and uses `getStaticProps`, it needs to define a list of paths to be statically generated.

When you export a function called `getStaticPaths` (Static Site Generation) from a page that uses dynamic routes, Next.js will statically pre-render all the paths specified by `getStaticPaths`.

```jsx
export async function getStaticPaths() {
  return {
    paths: [
      { params: { ... } }
    ],
    fallback: true // false or 'blocking'
  };
}
```

Note that`getStaticProps` **must** be used with `getStaticPaths`, and that you **cannot** use it with [`getServerSideProps`](/docs/basic-features/data-fetching/get-server-side-props.md).

The [`getStaticPaths` API reference](/docs/api-reference/data-fetching/get-static-paths.md) covers all parameters and props that can be used with `getStaticPaths`.

## When should I use getStaticPaths?

You should use `getStaticPaths` if you’re statically pre-rendering pages that use dynamic routes and:

- The data comes from a headless CMS
- The data comes from a database
- The data comes from the filesystem
- The data can be publicly cached (not user-specific)
- The page must be pre-rendered (for SEO) and be very fast — `getStaticProps` generates `HTML` and `JSON` files, both of which can be cached by a CDN for performance

## When does getStaticPaths run

`getStaticPaths` only runs at build time on server-side. If you're using [Incremental Static Regeneration](/docs/basic-features/data-fetching/incremental-static-regeneration.md), `getStaticPaths` can also be run on-demand _in the background_, but still only on the server-side.

## Where can I use getStaticPaths

`getStaticPaths` can only be exported from a **page**. You **cannot** export it from non-page files.

Note that you must use export `getStaticPaths` as a standalone function — it will **not** work if you add `getStaticPaths` as a property of the page component.

## Runs on every request in development

In development (`next dev`), `getStaticPaths` will be called on every request.

<div class="card">
  <a href="/docs/api-reference/data-fetching/get-static-paths.md">
    <b>getStaticPaths API Reference</b>
    <small>Read the API Reference for getStaticPaths</small>
  </a>
</div>
