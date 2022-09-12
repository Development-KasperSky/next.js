# Dynamic code evaluation is not available in Middlewares or Edge API Routes

#### Why This Error Occurred

`eval()`, `new Function()` or compiling WASM binaries dynamically is not allowed in Middlewares or Edge API Routes.
Specifically, the following APIs are not supported:

- `eval()`
- `new Function()`
- `WebAssembly.compile`
- `WebAssembly.instantiate` with [a buffer parameter](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/instantiate#primary_overload_%E2%80%94_taking_wasm_binary_code)

#### Possible Ways to Fix It

You can bundle your WASM binaries using `import`:

```typescript
import { NextResponse } from 'next/server'
import squareWasm from './square.wasm?module'

export default async function middleware() {
  const m = await WebAssembly.instantiate(squareWasm)
  const answer = m.exports.square(9)

  const response = NextResponse.next()
  response.headers.set('x-square', answer.toString())
  return response
}
```

In rare cases, your code could contain (or import) some dynamic code evaluation statements which _can not be reached at runtime_ and which can not be removed by treeshaking.
You can relax the check to allow specific files with your Middleware or Edge API Route exported [configuration](https://nextjs.org/docs/api-reference/edge-runtime#unsupported-apis).

Be warned that if these statements are executed on the Edge, _they will throw and cause a runtime error_.
