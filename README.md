# Flow Hooks

[![npm](https://img.shields.io/npm/v/flow-hooks)](https://www.npmjs.com/package/flow-hooks)
[![GitHub Workflow Status (event)](https://img.shields.io/github/workflow/status/radenkovic/flow-hooks/run-tests)](https://github.com/radenkovic/flow-hooks/actions?query=workflow%3Arun-tests)
[![codecov](https://codecov.io/gh/radenkovic/flow-hooks/branch/master/graph/badge.svg)](https://codecov.io/gh/radenkovic/flow-hooks)
![david](https://david-dm.org/radenkovic/flow-hooks.svg)

> Create chainable, reusable hooks to control the flow.

## Installation

- `yarn add flow-hooks`


## Example

Here's a quick example on flow control utilizing all basic hooks.

```js
const { flow, when, cancel, any, every } = require('flow-hooks');

// in some function
const result = await flow([
  (ctx) => {
    ctx.data = [];
  },
  (ctx) => {
    ctx.data.push('first value');
  },
  (ctx) => {
    ctx.run_when = true;
  },
  when(
    (ctx) => !!ctx.run_when, // when to run the hook
    (ctx) => {
      ctx.conditional_run = 'done';
    }
  ),
  (ctx) => {
    ctx.after_when = 'ok';
  },
  any([
    // will pickup the first api call that finished
    someApiCall,
    otherApiCall,
    thirdApiCall,
  ]),
  every([
    // will run all 3 api calls in parallel
    someApiCall,
    otherApiCall,
    thirdApiCall,
  ]),
  cancel(), // stop the flow, do not throw error
  (ctx) => {
    // this will not run because of cancel()
    ctx.after_cancel = 'ok';
  },
]);

```


## Creating a release

`git commit --allow-empty -m "Release 1.0.1"`