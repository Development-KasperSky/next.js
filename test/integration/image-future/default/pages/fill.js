import React from 'react'
import Image from 'next/future/image'

const Page = () => {
  return (
    <div>
      <h1>Fill Mode</h1>
      <div
        id="image-container-1"
        style={{
          height: '300px',
          width: '300px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <Image id="fill-image-1" src="/wide.png" sizes="300px" fill />
      </div>
    </div>
  )
}

export default Page
