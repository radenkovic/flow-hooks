const flow = require('./flow');

const when = (condition, func) => async (ctx) => {
  const shouldRun = await condition(ctx);
  if (!shouldRun) return ctx;
  if (Array.isArray(func)) {
    const result = await flow(func, ctx);
    return result;
  } else {
    return func(ctx);
  }
};

module.exports = when;
