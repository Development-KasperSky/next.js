# The `useFlushEffects` hook cannot be used more than once.

#### Why This Error Occurred

The `useFlushEffects` hook is being used more than once while a page is being rendered.

#### Possible Ways to Fix It

The `useFlushEffects` hook should only be called inside the body of the `pages/_app` component, before returning any `<Suspense>` boundaries. Restructure your application to prevent extraneous calls.
