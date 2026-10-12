# RFC 0001: flow-hooks v3, composition primitives for AI agents

- **Status:** Draft, open for comments
- **Author:** Dan Radenkovic
- **Created:** 2026-10-12
- **Target:** `flow-hooks@3.0.0`
- **Breaking:** Yes. The public contract changes completely.

## Summary

v3 turns flow-hooks from a general async flow library into **a small, typed toolkit for composing AI agents**. You build agents out of named steps and combine them with loops, routers, parallel fan-out, races, retries and human approval points. Every run can be streamed, traced, checkpointed and resumed.

flow-hooks **does not wrap any LLM SDK.** A step is a plain async function, so you call the Vercel AI SDK, the Anthropic or OpenAI SDKs, or plain `fetch` inside it. The core keeps zero runtime dependencies. Integrations ship as optional subpath exports.

```ts
import { flow, step, loop, map, when, interrupt } from 'flow-hooks';

const researcher = flow('researcher', [
  step('plan', async (ctx, { signal }) => ({
    plan: await planQueries(ctx.question, signal),
  })),
  map('search', (ctx) => ctx.plan.queries, [searchWeb], {
    into: 'sources',
    concurrency: 4,
  }),
  step('draft', writeDraft),
  loop('revise', [critique, revise], {
    until: (ctx) => ctx.score >= 8,
    max: 3,
  }),
  when((ctx) => ctx.risky, interrupt('approval')),
]);

const result = await researcher.run({ question }, { signal, checkpointer });
```

## Motivation

### What v2 already gets right for agents

v2's design maps onto agent workloads better than it might seem:

| v2 feature                       | Why it matters for agents                                           |
| -------------------------------- | ------------------------------------------------------------------- |
| `every()`                        | Fan-out to several agents or tools at once                          |
| `any()`                          | Model fallback and racing providers against each other              |
| `when()`                         | Guardrails and conditional steps                                    |
| `AbortSignal` sent to every step | Losing branches stop their LLM calls, which saves tokens and money  |
| Frozen context after each step   | Every step boundary is already a consistent snapshot to checkpoint  |
| Steps are plain functions        | Each step is unit-testable without a model, a server or a framework |

### What v2 is missing

Agent workflows need things v2 has no answer for:

1. **Loops.** The agent loop and the critique-and-revise loop are the most common agent shapes, and v2 can't express them.
2. **Routing.** A model picks which sub-agent handles a task. v2 only has `when()`, a yes/no branch.
3. **Pause and resume.** Human approval can take hours. v2 can't stop a run, store it and pick it up later.
4. **Visibility.** Agent runs are long and non-deterministic. Users need a live event stream for their UI and traces to debug runs. v2 gives you only the final context.
5. **Agents as tools.** Multi-agent systems are agents calling agents. v2 has no way to hand a flow to a model as a tool.
6. **Validated output.** Model output must be checked against a schema, and a failed check should trigger a retry.
7. **Shared transcripts.** Parallel agents writing to one `messages` array clobber each other under v2's last-write-wins merge.

### Where flow-hooks fits

The agent framework space is crowded: LangGraph.js, Mastra, OpenAI Agents SDK, Vercel AI SDK agents, VoltAgent, Inngest AgentKit. Most of them own the model layer, memory and deployment model. flow-hooks v3 deliberately does less:

- **Bring your own model.** No provider abstraction, no prompt templating, no vector store.
- **Primitives, not a platform.** Roughly what lodash or RxJS are to their domains: small functions that compose.
- **Plain functions all the way down.** Everything is testable without mocks of the library itself.
- **Zero runtime dependencies** in the core.

## Goals

- Express the common agent patterns in a few readable lines each: prompt chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer and the autonomous agent loop.
- Any flow can be nested in another flow, exposed as a tool, streamed and traced.
- Runs can pause for human input and resume later, possibly in another process.
- Typed end to end, with schema validation through [Standard Schema](https://standardschema.dev), so zod, valibot and arktype all work.
- Core stays dependency-free and small (target: under 5 kB min+gzip).

## Non-goals

- Calling models, managing prompts, or normalizing provider APIs.
- Memory, embeddings, retrieval or vector stores.
- A hosted runtime, queue or durable execution engine. Checkpointing is an interface; storage is the user's choice.
- A visual graph editor or arbitrary cyclic graphs. Flows are structured (sequences, branches, loops), not free-form graphs.

## Design

### Vocabulary

| Term    | Meaning                                                            |
| ------- | ------------------------------------------------------------------ |
| Step    | A function `(ctx, api) => patch` (v2 called this a hook)           |
| Context | The frozen object a run carries from step to step                  |
| Patch   | What a step returns: the keys it changes                           |
| Flow    | A named, reusable list of steps. A flow is also a step.            |
| Run     | One execution of a flow, identified by a `runId`                   |
| Path    | A step's position in a run, such as `researcher/revise#2/critique` |

The package name stays `flow-hooks` to keep its npm history, links and search ranking. The docs use "step" from v3 on.

### 1. A flow is a value

In v2, `flow(hooks, ctx)` runs immediately. In v3, `flow()` **defines** a flow and returns a `Flow` object:

```ts
const agent = flow('support-agent', steps, options);

agent.run(input, runOptions); // Promise<RunResult>
agent.stream(input, runOptions); // AsyncIterable<FlowEvent> with a .result promise
agent.resume(runId, answer, runOptions); // continue an interrupted run
agent.asTool(toolOptions); // expose the flow as a tool for a model
```

The name is optional (`flow(steps, options)` also works) but it's needed for tracing, checkpoints and `asTool()`.

**A `Flow` is also a step.** Put it in another flow's step list and it runs on the current context; its changes come back as one patch. For a sub-agent that should not see or touch the parent's context, use `isolate()`:

```ts
const supervisor = flow('supervisor', [
  triage, // shares the supervisor's context
  isolate(researcher, {
    input: (ctx) => ({ question: ctx.ticket.body }),
    output: (sub) => ({ findings: sub.answer }),
  }),
]);
```

### 2. Steps return patches

**This is the most important change.** In v2 a hook returned the whole next context (`{ ...ctx, total }`). In v3 a step returns **only the keys it changes**:

```ts
// v2
(ctx) => ({ ...ctx, total: sum(ctx.items) });

// v3
(ctx) => ({ total: sum(ctx.items) });
```

Rules:

- Returning `undefined` changes nothing, as before.
- Each key in the patch replaces that key, unless the key has a reducer (below).
- Setting a key to `undefined` clears it. Keys can't be deleted.
- The patch is frozen and the resulting context is frozen, as in v2.

Why:

- It removes the `...ctx` boilerplate, which is the most common mistake in v2 (forgetting the spread drops every other key).
- Parallel branches now report exactly what they changed. v2 had to diff each branch's result against the input to work that out.
- It enables reducers.

#### Reducers

A flow can declare a reducer per key. The reducer decides how a patch value combines with the current value:

```ts
import { flow, append } from 'flow-hooks';

const chat = flow('chat', steps, {
  reducers: { messages: append },
});

// A step adds messages instead of replacing the list:
const reply = async (ctx) => ({
  messages: [{ role: 'assistant', content: await answer(ctx.messages) }],
});
```

The core ships `append` (concatenate arrays), `merge` (shallow-merge objects) and `sum` (add numbers). A reducer is just `(current, update) => next`, so users write their own.

Reducers make parallel writes safe: when three agents run in `parallel()` and each appends a message, all three messages are kept, in step order.

When no reducer exists and two parallel branches change the same key, the later branch in the array wins, as in v2. (See open question 2.)

Type: a step returns `Patch<C>`, which is `Partial<Immutable<C>>`. A reducer for key `K` has the type `(current: C[K] | undefined, update: C[K]) => C[K]`.

### 3. Named steps

Steps can be plain functions, as in v2, or named with `step()`:

```ts
step('plan', planFn);
step({ name: 'plan', input: PlanInput, output: Plan, run: planFn });
```

Names appear in events, traces, error messages and checkpoint positions. An unnamed function is identified by its index. The full path joins the names of the enclosing flows, loop iterations and map items: `researcher/revise#2/critique`, `researcher/search[3]`.

Names must be unique among their siblings. `flow()` throws at definition time if they're not, because duplicates would make resume positions ambiguous.

### 4. The step API

The second argument to every step grows from `{ signal }` to:

```ts
interface StepApi {
  /** Aborted when the run is aborted, or when this branch is no longer needed. */
  readonly signal: AbortSignal;
  /** Unique ID of this run. Stable across interrupt and resume. */
  readonly runId: string;
  /** This step's path, e.g. `researcher/revise#2/critique`. */
  readonly path: string;
  /** 1 on the first attempt, then 2, 3, ... inside retry(). */
  readonly attempt: number;
  /** Streams partial output (tokens, progress) as an `emit` event. */
  emit(data: unknown): void;
  /** Reports model usage, counted against the run's limits. */
  usage(usage: Usage): void;
}

interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}
```

### 5. Composition primitives

All primitives return steps, so they nest freely.

#### Sequence and branching

| Primitive                             | Behaviour                                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| `flow(name?, steps, options?)`        | Runs steps in order                                                                       |
| `when(condition, steps, otherwise?)`  | Runs `steps` if the condition is truthy, otherwise `otherwise`. The `else` branch is new. |
| `route(select, routes, { default? })` | `select(ctx)` returns a route key (it can call a model). The matching steps run.          |
| `cancel(error?)`                      | Stops the run quietly, or fails it with `error`. Unchanged.                               |

`route()` rejects with a `RouteError` when `select()` returns a key that has no route and there's no `default`. Route keys come from model output, so this needs a clear error.

```ts
route(classifyTicket, {
  billing: billingAgent,
  technical: [gatherLogs, techAgent],
  default: escalateToHuman,
});
```

#### Loops

```ts
loop(name, steps, {
  until: (ctx, api) => boolean | Promise<boolean>, // checked after each iteration
  max: number, // required
  onMax?: 'stop' | 'throw', // default 'throw' (LoopLimitError)
});
```

`max` is **required**. An agent loop without a hard limit is a runaway bill. `api.path` includes the iteration number (`revise#2`).

The autonomous agent loop looks like this:

```ts
const agentLoop = loop('agent', [callModel, runToolCalls], {
  until: (ctx) => ctx.lastResponse.stopReason !== 'tool_use',
  max: 20,
});
```

#### Parallel work

| Primitive                           | Behaviour                                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `parallel(steps)`                   | Runs all branches at once and applies every patch in array order. Was `every()`.              |
| `race(steps)`                       | Runs all branches and continues with the first to succeed; the rest are aborted. Was `any()`. |
| `map(name, select, steps, options)` | Runs `steps` once per item from `select(ctx)`, with limited concurrency.                      |

`map()` options:

```ts
interface MapOptions<C, T, R> {
  /** Key the item is exposed under in each branch's context. Default `'item'`. */
  as?: string;
  /** Key the collected results are written to (through its reducer, if any). */
  into: keyof C;
  /** Value collected from each branch's final context. Default: the branch's patch. */
  collect?: (branchCtx: Immutable<C>) => R;
  /** Max branches in flight. Default: Infinity. */
  concurrency?: number;
  /** `true` collects `{ ok, value | error }` per item instead of failing fast. */
  settle?: boolean;
}
```

Each branch sees `{ ...ctx, [as]: item, index }`, and its changes stay in the branch. Only the collected array is written back. This is the orchestrator-workers pattern.

#### Reliability

| Primitive                                       | Behaviour                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| `retry(step, { attempts, backoff?, retryIf? })` | Re-runs a failing step. `backoff` is a ms delay or `(attempt) => ms`.           |
| `timeout(step, ms)`                             | Aborts the step's signal and rejects with a `TimeoutError` after `ms`.          |
| `fallback(steps)`                               | Tries each step in order until one succeeds (`race()` is the parallel version). |

These were recipes in v2. Every LLM call needs them, so they become built-ins.

### 6. Validated steps

`step()` accepts [Standard Schema](https://standardschema.dev) validators for the context it reads and the patch it returns:

```ts
import { z } from 'zod';

const Classification = z.object({
  category: z.enum(['billing', 'technical', 'other']),
  confidence: z.number().min(0).max(1),
});

const classify = step({
  name: 'classify',
  input: z.object({ ticket: z.object({ body: z.string() }) }),
  output: z.object({ classification: Classification }),
  run: async (ctx, { signal }) => ({
    classification: await classifyWithModel(ctx.ticket.body, signal),
  }),
});

// A model that returns bad output gets another try:
retry(classify, { attempts: 3, retryIf: isValidationError });
```

- A failed check throws a `ValidationError` carrying the schema's `issues`.
- The step's types are inferred from the schemas.
- Standard Schema is a types-only spec, so the core stays dependency-free.

### 7. Agents as tools

`asTool()` turns a flow into a provider-neutral tool definition:

```ts
const researchTool = researcher.asTool({
  name: 'research', // defaults to the flow name
  description: 'Researches a question on the web and returns a cited answer.',
  input: z.object({ question: z.string() }),
  output: (ctx) => ({ answer: ctx.answer, sources: ctx.sources }),
});

// researchTool: {
//   name, description,
//   inputSchema,                  // JSON Schema for the model
//   execute(input, { signal }),  // validates input, runs the flow, returns output(ctx)
// }
```

The input becomes the initial context. JSON Schema comes from the validator's [Standard JSON Schema](https://standardschema.dev) support where the library has it; otherwise pass `jsonSchema` explicitly.

Adapters convert this neutral shape into each ecosystem's format (section 11). When a tool runs inside a parent run, its events are forwarded into the parent's stream, nested under the calling step's path.

### 8. Running, streaming and results

```ts
interface RunOptions {
  signal?: AbortSignal;
  runId?: string; // default: crypto.randomUUID()
  checkpointer?: Checkpointer;
  limits?: {
    steps?: number;
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
  };
  onEvent?: (event: FlowEvent) => void;
}

type RunResult<C> =
  | { status: 'completed'; runId: string; context: Immutable<C> }
  | { status: 'cancelled'; runId: string; context: Immutable<C> }
  | {
      status: 'interrupted';
      runId: string;
      context: Immutable<C>;
      interrupt: InterruptInfo;
    };
```

`run()` resolves with a `RunResult` and rejects when a step fails. It replaces both `flow()` and `runFlow()` from v2. (`status` is the v2 `cancelled` flag, extended with `interrupted`.)

`stream()` returns the same run as an async iterable of events, with the result on `.result`:

```ts
type FlowEvent =
  | { type: 'run:start'; runId: string; flow: string }
  | { type: 'step:start'; path: string; name: string }
  | { type: 'step:end'; path: string; patch: object | undefined; ms: number }
  | { type: 'step:error'; path: string; error: unknown; attempt: number }
  | { type: 'emit'; path: string; data: unknown }
  | { type: 'usage'; path: string; usage: Usage }
  | { type: 'interrupt'; path: string; info: InterruptInfo }
  | { type: 'run:end'; status: RunResult<object>['status'] };
```

```ts
const run = agent.stream({ question });
for await (const event of run) {
  if (event.type === 'emit') ui.appendToken(event.data);
}
const result = await run.result;
```

Events are buffered when the consumer is slower than the run. Leaving the loop early does **not** abort the run; pass a `signal` for that.

**Limits:** `limits.steps` counts every step started. Token and cost limits count what steps report through `api.usage()`. Passing a limit aborts the run with a `LimitExceededError`.

**Errors:** a step's error is rethrown wrapped in a `StepError` with `path` and the original error as `cause`. That way "which step of which sub-agent failed" is always answerable. `race()` still rejects with an `AggregateError` of `StepError`s.

### 9. Interrupts and resume

`interrupt()` pauses a run until someone answers:

```ts
const refundAgent = flow('refund', [
  step('assess', assessClaim),
  when(
    (ctx) => ctx.amount > 500,
    interrupt('manager-approval', {
      payload: (ctx) => ({ amount: ctx.amount, reason: ctx.reason }),
      resume: (ctx, answer: { approved: boolean }) => ({
        approved: answer.approved,
      }),
    }),
  ),
  when((ctx) => ctx.approved !== false, step('refund', issueRefund)),
]);

const first = await refundAgent.run(claim, { checkpointer });
if (first.status === 'interrupted') {
  notifyManager(first.runId, first.interrupt.payload);
}

// Later, possibly in another process:
await refundAgent.resume(runId, { approved: true }, { checkpointer });
```

**Checkpointer interface:**

```ts
interface Checkpointer {
  save(checkpoint: Checkpoint): Promise<void>;
  load(runId: string): Promise<Checkpoint | undefined>;
}

interface Checkpoint {
  runId: string;
  flow: string;
  /** Hash of the flow's step names, to catch resuming against a changed flow. */
  version: string;
  path: string; // where the run stopped
  context: unknown; // serialized
  status: 'running' | 'interrupted' | 'completed' | 'cancelled' | 'failed';
  updatedAt: string;
}
```

- The core ships `memoryCheckpointer()`. Postgres, Redis and file implementations are small enough to live in recipes or separate packages.
- Checkpoints are saved after each top-level step and at every interrupt.
- A run that uses a checkpointer must have a JSON-serializable context, or the flow must provide `serialize`/`deserialize` options. `run()` rejects early if the context won't serialize.
- `resume()` rejects with a `VersionMismatchError` when the flow's structure changed since the checkpoint.

**v3.0 limit:** an `interrupt()` must sit in a sequence, a `when()`, a `route()` or a `loop()`. Interrupts inside `parallel()`, `race()` or `map()` branches throw at definition time. Resuming in the middle of concurrent branches needs per-branch checkpoints, which is left for later.

### 10. Testing kit (`flow-hooks/testing`)

Agent code is hard to test because models are non-deterministic. The kit makes runs reproducible without touching a model:

| Helper                       | Purpose                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `runStep(step, ctx, api?)`   | Runs one step and returns its patch, with a fake `api`.                        |
| `scripted(values)`           | Returns a function that yields `values` in order: a stand-in for a model call. |
| `collectEvents(flow, input)` | Runs a flow and returns `{ result, events }` for snapshot tests.               |
| `memoryCheckpointer()`       | Re-exported for interrupt/resume tests.                                        |

```ts
const callModel = scripted([
  {
    stopReason: 'tool_use',
    toolCalls: [{ name: 'search', input: { q: 'x' } }],
  },
  { stopReason: 'end_turn', text: 'Done' },
]);
```

### 11. Package layout

```text
flow-hooks              core: flow, step, primitives, reducers, errors, memoryCheckpointer
flow-hooks/testing      test helpers
flow-hooks/ai-sdk       asTool() output -> Vercel AI SDK tool()
flow-hooks/mcp          serve flows as MCP tools
flow-hooks/otel         OpenTelemetry spans from events (GenAI semantic conventions)
```

Integration subpaths declare their libraries as **optional peer dependencies**. Importing the core never loads them.

## Full example: evaluator-optimizer

```ts
import Anthropic from '@anthropic-ai/sdk';
import { flow, loop, step } from 'flow-hooks';

const anthropic = new Anthropic();
const ask = async (prompt: string, signal: AbortSignal) => {
  const res = await anthropic.messages.create(
    {
      model: 'claude-sonnet-5-5',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    },
    { signal },
  );
  return res.content[0].type === 'text' ? res.content[0].text : '';
};

const writer = flow('writer', [
  step('draft', async (ctx, { signal }) => ({
    draft: await ask(`Write a product description for: ${ctx.product}`, signal),
  })),
  loop(
    'improve',
    [
      step('review', async (ctx, { signal }) => {
        const review = JSON.parse(
          await ask(
            `Score 1-10 and critique as JSON {score, notes}:\n${ctx.draft}`,
            signal,
          ),
        );
        return { score: review.score, notes: review.notes };
      }),
      step('rewrite', async (ctx, { signal }) =>
        ctx.score >= 8
          ? undefined
          : {
              draft: await ask(
                `Rewrite using this feedback: ${ctx.notes}\n\n${ctx.draft}`,
                signal,
              ),
            },
      ),
    ],
    { until: (ctx) => ctx.score >= 8, max: 3, onMax: 'stop' },
  ),
]);

const { context } = await writer.run(
  { product: 'a solar-powered bike light' },
  { signal: AbortSignal.timeout(60_000) },
);
```

## Migration from v2

| v2                           | v3                                                        |
| ---------------------------- | --------------------------------------------------------- |
| `flow(hooks, ctx, opts)`     | `flow(hooks).run(ctx, opts)` then `.context`              |
| `runFlow(hooks, ctx, opts)`  | `flow(hooks).run(ctx, opts)`; `cancelled` is now `status` |
| `(ctx) => ({ ...ctx, x })`   | `(ctx) => ({ x })`                                        |
| `every(hooks)`               | `parallel(steps)`                                         |
| `any(hooks)`                 | `race(steps)`                                             |
| `when(cond, hooks)`          | Unchanged; an optional third argument adds an else branch |
| `cancel()` / `cancel(error)` | Unchanged                                                 |
| `Hook<C>`, `HookApi`         | `Step<C>`, `StepApi`                                      |
| Errors rethrown as is        | Wrapped in `StepError` (original on `.cause`)             |

v2 hooks that return the full context **keep working** for keys without a reducer, because writing a key with its current value changes nothing. They break for keys with a reducer: returning the whole `messages` array to an `append` key would duplicate it. The common-mistakes page must cover this, and `append` should warn in development when an update starts with the current array.

v2 will get security fixes for 12 months after 3.0 ships. A codemod is not planned: the changes are mechanical and few.

## Docs and SEO plan

The docs are rewritten for an agent-builder audience alongside the code.

1. **Move off docsify.** It serves pages under hash URLs (`/#/recipes`), which search engines barely index. Switch to VitePress or Astro Starlight with a real URL per page, a generated sitemap and per-page meta tags.
2. **Organize by agent pattern,** using the names people search for: prompt chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer, autonomous agent loop, human-in-the-loop, agents as tools. One page and one runnable example each.
3. **Examples run without an API key** by default using `scripted()`, with a flag to run them against a real provider.
4. **Comparison pages:** "flow-hooks vs LangGraph.js", "vs Mastra", "vs OpenAI Agents SDK". Honest, with a "when to use the other one" section.
5. **AI-readable docs:** `llms.txt` and `llms-full.txt` at the site root, an `AGENTS.md` in the repo, and possibly an agent skill. Coding assistants increasingly choose libraries for developers.
6. **README** opens with the evaluator-optimizer example instead of the checkout flow.
7. **package.json:**
   - Description: "Compose AI agents from small, typed, immutable steps: loop, route, fan out, race and hand off, with cancellation, checkpoints and tracing. Works with any LLM SDK. Zero dependencies."
   - Keywords added: `ai`, `ai-agents`, `agent`, `agent-orchestration`, `multi-agent`, `agentic-workflow`, `llm`, `tool-calling`, `human-in-the-loop`, `mcp`, `ai-sdk`, `langgraph-alternative`.

## Rollout

| Milestone       | Contents                                                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `3.0.0-alpha.1` | `Flow` value, `step()`, patch returns and reducers, `when`/`route`/`loop`/`parallel`/`race`/`map`, `retry`/`timeout`/`fallback`, events and `stream()`, `StepError`, `flow-hooks/testing` |
| `3.0.0-alpha.2` | Standard Schema steps, `asTool()`, limits and `api.usage()`, `isolate()`                                                                                                                  |
| `3.0.0-beta.1`  | `interrupt()`/`resume()`, `Checkpointer`, `memoryCheckpointer()`, `flow-hooks/ai-sdk`, `flow-hooks/mcp`                                                                                   |
| `3.0.0`         | New docs site with pattern pages, migration guide, API freeze                                                                                                                             |
| `3.1`           | `flow-hooks/otel`, comparison pages, interrupts inside parallel branches                                                                                                                  |

Each milestone ships to the `next` npm dist-tag until 3.0.0.

## Alternatives considered

- **Keep full-context returns (v2 semantics).** Smaller migration, but parallel writes to shared keys stay lossy, and reducers can't be added without patches. Rejected.
- **Per-key reducers on every key, LangGraph-style channels.** More powerful but forces a schema declaration up front. Reducers are opt-in per key instead.
- **Free-form graph API (nodes and edges).** Cycles and jumps are hard to type, hard to read and hard to checkpoint. Structured `loop()`/`route()` cover the agent patterns we know about.
- **Bundle a model abstraction.** Would compete with the Vercel AI SDK and the providers' own SDKs and add dependencies. The neutral `asTool()` shape plus adapters gives the integration without the lock-in.
- **Rename the package** (for example to `flow-agents`). Loses npm history, existing links and search ranking. The tagline and keywords carry the new focus instead.

## Open questions

1. **Nested reducers.** When a flow is used as a step inside another flow, whose reducers apply: the child's, the parent's, or the child's layered over the parent's? The proposal leans towards "layered", with a definition-time error when both declare a reducer for the same key.
2. **Parallel conflicts.** Should two `parallel()` branches writing the same key without a reducer be an error instead of last-wins? Safer, but it breaks a v2 behaviour some users rely on.
3. **Error wrapping.** Is `StepError` with a `cause` worth the extra `error.cause` lookup for users who check `instanceof` on their own errors? An alternative is to attach `path` to the original error without wrapping it.
4. **`stream()` backpressure.** Unbounded buffering is simple but could grow large for token-level `emit` in long runs. A bounded buffer that drops `emit` events is the alternative.
5. **Checkpoint frequency.** Saving after every top-level step is safe but chatty for fast flows. Should it be configurable (`'step' | 'interrupt-only'`)?
6. **Name of `isolate()`.** Alternatives: `subflow()`, `scope()`, `call()`.

Comments are welcome on the pull request that adds this RFC, or in a GitHub issue that links to it.
