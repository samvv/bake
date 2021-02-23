Bake
====

Bake supercharges the`scripts` entry in your `package.json`. Using Bake, you
can use Bash scripts on any platform and start up your development server in
seconds and keep your log files clean.

## How It Works

Bake acts like a little shell and parses whatever you have inside your`scripts`
field in `package.json`. It filters the scripts using a pattern that you
provided and then starts executing the tasks in parallel. Whenever Bake runs
itself during this process, it will catch the command and spawn it in a local 
pool of processes.

As a consequence to this approach, every sub-program is spawned in just one
NodeJS process and all log output can be processed by the same NodeJS process.
This not only results in much cleaner log files, but also saves some working
memory.

**package.json**
```json
{
  "scripts": {
     "watch:compile-tests": "tsc -w",
     "watch:tests": "ava --watch",
     "prepare": "tsc --noEmit && webpack --mode production",
     "serve": "webpack serve --mode development"
  }
}
```

If you run the following command, Bake will run a TypeScript compiler, a test
runner and a development server all at once.

```sh
bake watch serve
```

If you want to run two tasks in parallel in `package.json`, simply add them as
arguments to the `bake` command and Bake will take care of the rest. You can
make this even more concise by naming the script `"bake"`.  For example:

```json
{
  "scripts": {
    "watch:tests": "ava --watch",
    "watch:sources": "tsc -w --preserveWatchOutput",
    "serve": "webpack serve --mode development"
    "prepare": "tsc --noEmit && webpack --mode production",
    "bake": "bake watch serve"
  }
}
```

If you run `bake` with the above configuration your two tasks will run in parallel.

## Bugs And Issues

If you're having an issue, please take the time to report it in the [issue
tracker][1]. This will make the tool much more robust and easier for others to
pick up.

## License

The code in this repository is licensed under the MIT license.

