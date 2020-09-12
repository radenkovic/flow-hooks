const Promise = require('bluebird');
const CancelFlow = require('./cancel-exception');

const flow = async (hooks, initialContext) => {
  let ctx = { ...initialContext }; // cloned
  try {
    await hooks.reduce(async (previousPromise, func) => {
      const prevCtx = await previousPromise;
      // Always create Fresh object
      ctx = prevCtx ? { ...prevCtx } : { ...ctx };
      return func(ctx);
    }, Promise.resolve(ctx));
    return ctx;
  } catch (e) {
    if (e instanceof CancelFlow) {
      return ctx;
    } else {
      throw e;
    }
  }
};

module.exports = flow;
