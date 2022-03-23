import fs from 'fs'
import path from 'path'
import { useRouter } from 'next/router'

export async function getServerSideProps({ res }) {
  res.setHeader('cache-control', 's-maxage=1, stale-while-revalidate')

  const data = await fs.promises.readFile(
    path.join(process.cwd(), 'data.txt'),
    'utf8'
  )

  if (data.trim() === 'hide') {
    return {
      notFound: true,
    }
  }

  return {
    props: {
      hello: 'world',
      data,
      random: Math.random(),
      // make sure fetch if polyfilled
      example: await fetch('https://example.com').then((res) => res.text()),
    },
  }
}

export default function Page(props) {
  const router = useRouter()

  return (
    <>
      <p id="gssp">getServerSideProps page</p>
      <p id="router">{JSON.stringify(router)}</p>
      <p id="props">{JSON.stringify(props)}</p>
    </>
  )
}
