/**
 * @jest-environment @edge-runtime/jest-environment
 */

import { NextResponse } from 'next/dist/server/web/spec-extension/response'

const toJSON = async (response) => ({
  body: await response.json(),
  contentType: response.headers.get('content-type'),
  status: response.status,
})

it('automatically parses and formats JSON', async () => {
  expect(await toJSON(NextResponse.json({ message: 'hello!' }))).toMatchObject({
    contentType: 'application/json',
    body: { message: 'hello!' },
  })

  expect(
    await toJSON(NextResponse.json({ status: 'success' }, { status: 201 }))
  ).toMatchObject({
    contentType: 'application/json',
    body: { status: 'success' },
    status: 201,
  })

  expect(
    await toJSON(
      NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 })
    )
  ).toMatchObject({
    contentType: 'application/json',
    body: { error: { code: 'bad_request' } },
    status: 400,
  })

  expect(await toJSON(NextResponse.json(null))).toMatchObject({
    contentType: 'application/json',
    body: null,
  })

  expect(await toJSON(NextResponse.json(''))).toMatchObject({
    contentType: 'application/json',
    body: '',
  })
})
