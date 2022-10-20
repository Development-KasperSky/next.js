'use client'

import getType, { named, value, array, obj } from 'non-isomorphic-text'

import add from 'untranspiled-module'

export default function Page() {
  return (
    <div>
      <div>{`module type:${getType()}`}</div>
      <div>{`export named:${named}`}</div>
      <div>{`export value:${value}`}</div>
      <div>{`export array:${array.join(',')}`}</div>
      <div>{`export object:{x:${obj.x}}`}</div>
      <div>{`transpilePackages:${add(2, 3)}`}</div>
    </div>
  )
}
