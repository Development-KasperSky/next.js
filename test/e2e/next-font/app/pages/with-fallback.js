import { Open_Sans } from '@next/font/google'
const openSans = Open_Sans({ fallback: ['system-ui', 'Arial'] })

export default function WithFonts() {
  return (
    <>
      <div id="with-fallback-fonts-classname" className={openSans.className}>
        {JSON.stringify(openSans)}
      </div>
      <div id="with-fallback-fonts-style" style={openSans.style}>
        {JSON.stringify(openSans)}
      </div>
      <div
        id="with-fallback-fonts-variable"
        style={{ fontFamily: 'var(--next-font-open-sans)' }}
        className={openSans.variable}
      >
        {JSON.stringify(openSans)}
      </div>
    </>
  )
}
