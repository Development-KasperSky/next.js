---
description: Learn how to deploy your Next.js app to production, either managed or self-hosted.
---

# Deployment

Congratulations, you are ready to deploy your Next.js application to production. This document will show how to deploy either managed or self-hosted using the [Next.js Build API](#nextjs-build-api).

## Next.js Build API

`next build` generates an optimized version of your application for production. This standard output includes:

- HTML files for pages using `getStaticProps` or [Automatic Static Optimization](/docs/advanced-features/automatic-static-optimization.md)
- CSS files for global styles or for individually scoped styles
- JavaScript for pre-rendering dynamic content from the Next.js server
- JavaScript for interactivity on the client-side through React

This output is generated inside the `.next` folder:

- `.next/static/chunks/pages` – Each JavaScript file inside this folder relates to the route with the same name. For example, `.next/static/chunks/pages/about.js` would be the JavaScript file loaded when viewing the `/about` route in your application
- `.next/static/media` – Statically imported images from `next/image` are hashed and copied here
- `.next/static/css` – Global CSS files for all pages in your application
- `.next/server/pages` – The HTML and JavaScript entry points prerendered from the server. The `.nft.json` files are created when [Output File Tracing](/docs/advanced-features/output-file-tracing.md) is enabled and contain all the file paths that depend on a given page.
- `.next/server/chunks` – Shared JavaScript chunks used in multiple places throughout your application
- `.next/cache` – Output for the build cache and cached images, responses, and pages from the Next.js server. Using a cache helps decrease build times and improve performance of loading images

All JavaScript code inside `.next` has been **compiled** and browser bundles have been **minified** to help achieve the best performance and support [all modern browsers](/docs/basic-features/supported-browsers-features.md).

## Managed Next.js with Vercel

[Vercel](https://vercel.com/) is a frontend cloud platform from the creators of Next.js. It's the fastest way to deploy your managed Next.js application with zero configuration.

When deploying to Vercel, the platform automatically detects Next.js, runs `next build`, and optimizes the build output for you, including:

- Persisting cached assets across deployments if unchanged
- [Immutable deployments](https://vercel.com/features/previews) with a unique URL for every commit
- [Pages](/docs/basic-features/pages.md) are automatically statically optimized, if possible
- Assets (JavaScript, CSS, images, fonts) are compressed and served from a [Global Edge Network](https://vercel.com/features/infrastructure)
- [API Routes](/docs/api-routes/introduction.md) are automatically optimized as isolated [Serverless Functions](https://vercel.com/features/infrastructure) that can scale infinitely
- [Middleware](/docs/middleware.md) are automatically optimized as [Edge Functions](https://vercel.com/features/edge-functions) that have zero cold starts and boot instantly

In addition, Vercel provides features like:

- Automatic performance monitoring with [Next.js Analytics](https://vercel.com/analytics)
- Automatic HTTPS and SSL certificates
- Automatic CI/CD (through GitHub, GitLab, Bitbucket, etc.)
- Support for [Environment Variables](https://vercel.com/docs/environment-variables)
- Support for [Custom Domains](https://vercel.com/docs/custom-domains)
- Support for [Image Optimization](/docs/basic-features/image-optimization.md) with `next/image`
- Instant global deployments via `git push`

You can start using Vercel (for free) through a personal hobby account, or create a team to start the next big thing. Learn more about [Next.js on Vercel](https://vercel.com/solutions/nextjs) or read the [Vercel Documentation](https://vercel.com/docs).

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/git/external?repository-url=https://github.com/vercel/next.js/tree/canary/examples/hello-world&project-name=hello-world&repository-name=hello-world&utm_source=github.com&utm_medium=referral&utm_campaign=deployment)

## Self-Hosting

You can self-host Next.js with support for all features using Node.js or Docker. You can also do a Static HTML Export, which [has some limitations](/docs/advanced-features/static-html-export.md).

### Node.js Server

Next.js can be deployed to any hosting provider that supports Node.js. For example, [AWS EC2](https://aws.amazon.com/ec2/) or a [DigitalOcean Droplet](https://www.digitalocean.com/products/droplets/).

First, ensure your `package.json` has the `"build"` and `"start"` scripts:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  }
}
```

Then, run `next build` to build your application. Finally, run `next start` to start the Node.js server. This server supports all features of Next.js.

> If you are using [`next/image`](/docs/basic-features/image-optimization.md), consider adding `sharp` for more performant [Image Optimization](/docs/basic-features/image-optimization.md) in your production environment by running `npm install sharp` in your project directory. On Linux platforms, `sharp` may require [additional configuration](https://sharp.pixelplumbing.com/install#linux-memory-allocator) to prevent excessive memory usage.

### Docker Image

Next.js can be deployed to any hosting provider that supports [Docker](https://www.docker.com/) containers. You can use this approach when deploying to container orchestrators such as [Kubernetes](https://kubernetes.io/) or [HashiCorp Nomad](https://www.nomadproject.io/), or when running inside a single node in any cloud provider.

1. [Install Docker](https://docs.docker.com/get-docker/) on your machine
1. Clone the [with-docker](https://github.com/vercel/next.js/tree/canary/examples/with-docker) example
1. Build your container: `docker build -t nextjs-docker .`
1. Run your container: `docker run -p 3000:3000 nextjs-docker`

### Static HTML Export

If you’d like to do a static HTML export of your Next.js app, follow the directions on our [Static HTML Export documentation](/docs/advanced-features/static-html-export.md).

## Automatic Updates

When you deploy your Next.js application, you want to see the latest version without needing to reload.

Next.js will automatically load the latest version of your application in the background when routing. For client-side navigations, `next/link` will temporarily function as a normal `<a>` tag.

**Note:** If a new page (with an old version) has already been prefetched by `next/link`, Next.js will use the old version. Navigating to a page that has _not_ been prefetched (and is not cached at the CDN level) will load the latest version.

## Related

For more information on what to do next, we recommend the following sections:

<div class="card">
  <a href="/docs/going-to-production.md">
    <b>Going to Production:</b>
    <small>Ensure the best performance and user experience.</small>
  </a>
</div>
