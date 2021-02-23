Bake
====

Bake is a small task runnner for JavaScript developers that supercharges
the`scripts` entry in your `package.json`. Using Bake, you can start up your
development server in seconds and keep your log files clean.

## How It Works

Bake acts like a little shell and parses whatever you have inside your
`scripts` field in `package.json`. It builds a dependency graph of the
different programs it should run, matching them with the pattern you provided.
For instance, if you have `tsc --noEmit && babel src`, Bake knows that it first
should run TypeScript and only when that command completes continue by running
Babel.

As a consequence to this approach, every sub-program is spawned in just one
NodeJS process and all log output can be processed by the same NodeJS process.
This not only results in much cleaner log files, but also saves some working
memory.

## FAQ

### How do I run two tasks in parallel?

Simply add them as arguments to `bake` and Bake will take care of the rest. For
instance:

```json
{
  "scripts": {
    "watch-tests": "ava --watch",
    "watch-sources": "tsc -w --preserveWatchOutput",
    "watch": "bake watch-sources watch-tests"
  }
}
```

If you run `bake watch` with the above configuration your two tasks will run in parallel.

## License

The code in this repository is licensed under the MIT license.

