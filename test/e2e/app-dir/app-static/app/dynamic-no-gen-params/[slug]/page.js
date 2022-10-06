import Link from 'next/link'

export default function Page({ params }) {
  return (
    <>
      <p id="page">/dynamic-no-gen-params</p>
      <p id="params">{JSON.stringify(params)}</p>

      <Link href="/dynamic-no-gen-params/second">
        <a id="dynamic-no-params-again">/dynamic-no-gen-params/second</a>
      </Link>
      <br />

      <Link href="/blog/styfle">
        <a id="to-blog">/blog/styfle</a>
      </Link>
      <br />
    </>
  )
}
