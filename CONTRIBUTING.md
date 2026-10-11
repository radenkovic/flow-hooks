# Contributing

Thanks for helping improve flow-hooks! Bug reports, docs fixes and pull requests are all welcome.

## Reporting a bug

[Open an issue](https://github.com/radenkovic/flow-hooks/issues/new) with a minimal flow that shows the problem, what you expected, and what happened instead. Include your Node.js version.

## Making a change

```sh
git clone https://github.com/radenkovic/flow-hooks.git
cd flow-hooks
npm install
npm run test:watch
```

Before opening a pull request, run the full check. CI runs the same thing:

```sh
npm run check
```

It lints, type-checks, runs the tests with a 100% coverage threshold, builds the package and validates the published exports.

- Add or update tests for any behaviour change. Type-level behaviour is tested in `test/types.test-d.ts`.
- Update the docs in `docs/` and the README if the public API changes.
- Examples in `examples/` are run by the test suite, which checks that each one prints the output in its closing `/* Output: */` comment. Run one by hand with `npm run example examples/01-basics.ts`.
- Add a line to `CHANGELOG.md` under an "Unreleased" heading.

## Docs site

The site in `docs/` is [docsify](https://docsify.js.org/), served by GitHub Pages. To preview it locally:

```sh
python3 -m http.server 4173 -d docs
```

Then open http://localhost:4173.
