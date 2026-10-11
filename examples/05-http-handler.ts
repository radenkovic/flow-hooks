// An HTTP handler built from reusable steps, using the standard Request and
// Response classes. The same code works in Hono, Bun, Deno, Next.js route
// handlers and Cloudflare Workers. Here we call it directly with a Request.
//
// Run it: npm run example examples/05-http-handler.ts

import { cancel, runFlow, when, type Hook } from 'flow-hooks';

// --- Pretend services -------------------------------------------------------

interface User {
  name: string;
  roles: string[];
}

const usersByToken = new Map<string, User>([
  ['token-ada', { name: 'Ada', roles: ['viewer', 'editor'] }],
  ['token-bob', { name: 'Bob', roles: ['viewer'] }],
]);

let nextId = 1;
async function insertProject(name: string, owner: string) {
  await Promise.resolve();
  return { id: nextId++, name, owner };
}

// --- Reusable steps ---------------------------------------------------------

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface Ctx {
  request: Request; // class instances are kept as they are, not copied
  user?: User;
  body?: { name?: string };
  response?: Response;
}

const authenticate: Hook<Ctx> = (ctx) => {
  const token = ctx.request.headers
    .get('authorization')
    ?.slice('Bearer '.length);
  const user = token === undefined ? undefined : usersByToken.get(token);
  if (!user) throw new HttpError(401, 'Sign in first');
  return { ...ctx, user };
};

// A hook factory: a function that returns a configured hook.
const requireRole =
  (role: string): Hook<Ctx> =>
  (ctx) => {
    if (!ctx.user?.roles.includes(role)) {
      throw new HttpError(403, `Only ${role}s can do that`);
    }
  };

const parseJson: Hook<Ctx> = async (ctx) => {
  try {
    return { ...ctx, body: (await ctx.request.json()) as { name?: string } };
  } catch {
    throw new HttpError(400, 'Body must be JSON');
  }
};

/** Turns a list of hooks into a `(request) => response` handler. */
function handler(hooks: Hook<Ctx>[]) {
  return async (request: Request): Promise<Response> => {
    try {
      const { context } = await runFlow(hooks, { request });
      return context.response ?? new Response(null, { status: 204 });
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      return Response.json({ error: error.message }, { status: error.status });
    }
  };
}

// --- A route ----------------------------------------------------------------

const createProject = handler([
  authenticate,
  requireRole('editor'),
  parseJson,
  when(
    (ctx) => typeof ctx.body?.name !== 'string',
    cancel(new HttpError(422, 'name is required')),
  ),
  async (ctx) => {
    const project = await insertProject(
      ctx.body?.name ?? '',
      ctx.user?.name ?? '',
    );
    return { ...ctx, response: Response.json(project, { status: 201 }) };
  },
]);

// --- Try it -----------------------------------------------------------------

async function post(token: string | null, body: string): Promise<void> {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const request = new Request('http://localhost/projects', {
    method: 'POST',
    headers,
    body,
  });
  const response = await createProject(request);
  console.log(response.status, await response.text());
}

await post(null, '{"name":"Docs"}');
await post('token-bob', '{"name":"Docs"}');
await post('token-ada', 'not json');
await post('token-ada', '{}');
await post('token-ada', '{"name":"Docs"}');

/* Output:
401 {"error":"Sign in first"}
403 {"error":"Only editors can do that"}
400 {"error":"Body must be JSON"}
422 {"error":"name is required"}
201 {"id":1,"name":"Docs","owner":"Ada"}
*/
