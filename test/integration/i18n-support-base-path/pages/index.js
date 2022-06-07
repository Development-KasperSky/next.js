import Link from 'next/link'
import { useRouter } from 'next/router'
import { useEffect } from 'react'
import { useState } from 'react'

export default function Page(props) {
  const router = useRouter()
  const parsedAs = new URL(router.asPath, 'http://n')
  const [asPath, setAsPath] = useState(parsedAs.pathname)

  useEffect(() => {
    if (router.isReady && router.asPath && asPath !== router.asPath) {
      setAsPath(router.asPath)
    }
  }, [router.asPath, router.isReady, asPath])

  return (
    <>
      <p id="index">index page</p>
      <p id="props">{JSON.stringify(props)}</p>
      <p id="router-locale">{router.locale}</p>
      <p id="router-default-locale">{router.defaultLocale}</p>
      <p id="router-locales">{JSON.stringify(router.locales)}</p>
      <p id="router-domain-locales">{JSON.stringify(router.domainLocales)}</p>
      <p id="router-query">{JSON.stringify(router.query)}</p>
      <p id="router-pathname">{router.pathname}</p>
      <p id="router-as-path">{asPath}</p>
      <Link href="/another">
        <a id="to-another">to /another</a>
      </Link>
      <br />
      <Link href="/dynamic/first">
        <a id="to-dynamic">to /dynamic/first</a>
      </Link>
      <br />
      <Link href="/gsp">
        <a id="to-gsp">to /gsp</a>
      </Link>
      <br />
      <Link href="/gsp/fallback/first">
        <a id="to-fallback-first">to /gsp/fallback/first</a>
      </Link>
      <br />
      <Link href="/gsp/fallback/hello">
        <a id="to-fallback-hello">to /gsp/fallback/hello</a>
      </Link>
      <br />
      <Link href="/gsp/no-fallback/first">
        <a id="to-no-fallback-first">to /gsp/no-fallback/first</a>
      </Link>
      <br />
      <Link href="/gssp">
        <a id="to-gssp">to /gssp</a>
      </Link>
      <br />
      <Link href="/gssp/first">
        <a id="to-gssp-slug">to /gssp/first</a>
      </Link>
      <br />
      <Link href="/api/post/asdf">
        <a id="to-api-post">to /api/post/[slug]</a>
      </Link>
      <br />
    </>
  )
}

export const getStaticProps = ({ locale, locales, defaultLocale }) => {
  return {
    props: {
      locale,
      locales,
      defaultLocale,
    },
  }
}
