const all = require('../lib');

it('lib can be imported', () => {
  expect(all).toBeDefined();
});

it('all modules registered', () => {
  expect(all).toHaveProperty('any');
  expect(all).toHaveProperty('cancel');
  expect(all).toHaveProperty('every');
  expect(all).toHaveProperty('flow');
  expect(all).toHaveProperty('when');
});
