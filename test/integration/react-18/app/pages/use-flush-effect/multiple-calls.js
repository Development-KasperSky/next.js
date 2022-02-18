import { unstable_useFlushEffects } from 'next/streaming'

function Component() {
  if (typeof window === 'undefined') {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    unstable_useFlushEffects([])
  }
  return null
}

export default function MultipleCalls() {
  return (
    <>
      <Component />
      <Component />
    </>
  )
}

export async function getServerSideProps() {
  // disable exporting this page
  return { props: {} }
}
