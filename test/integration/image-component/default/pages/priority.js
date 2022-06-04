import React from 'react'
import Image from 'next/image'

const Page = () => {
  return (
    <div>
      <p>Priority Page</p>
      <Image
        priority
        id="basic-image"
        src="/test.jpg"
        width="400"
        height="400"
      ></Image>
      <Image
        loading="eager"
        id="load-eager"
        src="/test.png"
        width="400"
        height="400"
      ></Image>
      <Image
        priority
        id="responsive1"
        src="/wide.png"
        width="1200"
        height="700"
        layout="responsive"
      />
      <Image
        priority
        id="responsive2"
        src="/wide.png"
        width="1200"
        height="700"
        layout="responsive"
      />
      <Image
        priority
        id="raw1"
        src="/test.webp"
        width="1200"
        height="700"
        layout="raw"
      />
      <p id="stubtext">This is the priority page</p>
    </div>
  )
}

export default Page
