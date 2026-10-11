# Examples

Complete programs you can read top to bottom and run. Each one is a single file with no setup: the "services" they call (databases, APIs) are small fakes defined at the top, so you can see exactly what happens.

They're in the [`examples/`](https://github.com/radenkovic/flow-hooks/tree/master/examples) folder of the repository. Each file ends with the output it prints, and CI runs every example and checks that output, so they always match the current version.

| Example                                                                                                             | Shows                                                                                     |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [01-basics](https://github.com/radenkovic/flow-hooks/blob/master/examples/01-basics.ts)                             | Returning the next context, side-effect steps, `when()`, the frozen result                |
| [02-stopping-early](https://github.com/radenkovic/flow-hooks/blob/master/examples/02-stopping-early.ts)             | A sign-up flow: `cancel()` vs `cancel(error)`, and `runFlow()` to tell them apart         |
| [03-parallel](https://github.com/radenkovic/flow-hooks/blob/master/examples/03-parallel.ts)                         | A product page: loading data with `every()`, racing mirrors with `any()`                  |
| [04-retries-and-timeouts](https://github.com/radenkovic/flow-hooks/blob/master/examples/04-retries-and-timeouts.ts) | `retry()`, `withTimeout()` and `optional()` helpers, and a deadline for the whole flow    |
| [05-http-handler](https://github.com/radenkovic/flow-hooks/blob/master/examples/05-http-handler.ts)                 | A `Request → Response` handler from reusable steps: auth, roles, JSON parsing, validation |
| [06-webhook-worker](https://github.com/radenkovic/flow-hooks/blob/master/examples/06-webhook-worker.ts)             | A queue worker: skipping duplicates, parallel side effects, graceful shutdown             |
| [07-testing](https://github.com/radenkovic/flow-hooks/blob/master/examples/07-testing.ts)                           | Testing single hooks, a few hooks together, and a whole flow                              |

## Running them

The examples are TypeScript, which Node.js 22.18 and later runs directly:

```bash
git clone https://github.com/radenkovic/flow-hooks.git
cd flow-hooks
npm install
npm run example examples/03-parallel.ts
```

`npm run example` builds the package first, because the examples import `flow-hooks` the same way your code does.

## A taste

This is [05-http-handler](https://github.com/radenkovic/flow-hooks/blob/master/examples/05-http-handler.ts), shortened. Each step is a small hook, and the route reads as a list of what happens to a request:

```ts
const createProject = handler([
  authenticate, // 401 if there's no valid token
  requireRole('editor'), // 403 for everyone else
  parseJson, // 400 if the body isn't JSON
  when(
    (ctx) => typeof ctx.body?.name !== 'string',
    cancel(new HttpError(422, 'name is required')),
  ),
  async (ctx) => {
    const project = await insertProject(ctx.body.name, ctx.user.name);
    return { ...ctx, response: Response.json(project, { status: 201 }) };
  },
]);

const response = await createProject(request);
```
