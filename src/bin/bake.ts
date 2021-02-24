#!/usr/bin/env node

import path from "path";
import cp from "child_process";
import fs from "fs";

import npmWhich from "npm-which";
import Minimatch from "minimatch";
import chalk from "chalk";

import {
  PrefixTransformStream,
  upsearch,
  readJson,
  JsonObject,
  isObject,
  shellJoin
} from "../util";

import {
  error,
  verbose
} from "../logging";

import {
  evalShellCommand,
  ShellCommand,
  SpawnOptions
} from "../shell";

function countChars(str: string, needle: string) {
  let count = 0;
  for (const ch of str) {
    if (ch === needle) {
      count++;
    }
  }
  return count;
}

function matchTaskName(taskName: string, expected: string[]): boolean {
  if (expected.length === 0) {
    return true;
  }
  for (const pattern of expected) {
    const k = countChars(pattern, ':');
    const taskNamePart = taskName.split(':').slice(0, k+1).join(':');
    if (Minimatch(taskNamePart, pattern)) {
      return true;
    }
  }
  return false;
}

function spawnWithPrefix(argv: string[], {
  cwd = process.cwd(),
  env = process.env,
  prefix = '',
}: SpawnOptions & { prefix?: string }): Promise<number | null> {

  return new Promise((accept, reject) => {

    const [progName, ...args] = argv;

    const progPath = npmWhich.sync(progName, { cwd });

    const childProcess = cp.spawn(progPath, args, {
      cwd,
      env,
      stdio: [ 'inherit', 'pipe', 'pipe' ]
    });

    childProcess.stdout
      .pipe(new PrefixTransformStream({ prefix }))
      .pipe(process.stdout)

    childProcess.stderr
      .pipe(new PrefixTransformStream({ prefix }))
      .pipe(process.stderr)

    childProcess.once('exit', code => {
      if (code !== 0) {
        process.stderr.write(prefix + chalk.red(`Process ${shellJoin(argv)} exited with non-zero exit code ${code}\n`)) 
      }
      accept(code);
    });

    childProcess.on('error', error => {
      reject(error);
    });

  });

}

type PackageJsonScripts = { [name: string]: string }

function parseFlag(flag: string) {
  let i;
  for (i = 0; i < flag.length; i++) {
    if (flag[i] !== '-') {
      break;
    }
  }
  const k = flag.indexOf('=', i);
  let flagName;
  let flagValue;
  if (k !== null) {
    flagName = flag.substr(i, k);
    flagValue = flag.substr(k+1);
  } else {
    flagName = flag.substr(i);
    flagValue = k;
  }
  return [ flagName, flagValue ];
}

async function invoke(args: string[]) {

  let cwd = '.';
  const expectedTaskNames: string[] = [];

  let i;

  for (i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('-')) {
      let [flagName, flagValue] = parseFlag(arg);
      if (flagName === 'C' || flagName === 'work-dir') {
        if (flagValue === null) {
          flagValue = args[++i];
          if (flagValue === undefined) {
            error(`${arg} did not receive a value`);
            return 1;
          }
        }
        cwd = flagValue;
      } else {
        error(`${arg} was not recognised as a valid command-line flag by Bake`)
        return 1;
      }
    } else {
      expectedTaskNames.push(arg);
    }
  }

  const bakeBinPath = npmWhich(cwd).sync('bake');

  if (bakeBinPath && fs.realpathSync(__filename) !== fs.realpathSync(bakeBinPath)) {
    verbose(`Re-spawning with local installation of Bake`);
    const exitCode = cp.spawnSync(bakeBinPath, args, {
      stdio: 'inherit',
    }).status;
    return exitCode === null ? 1 : exitCode;
  }

  if (expectedTaskNames.length === 0) { 
    expectedTaskNames.push('bake');
  }

  const packageJsonPath = await upsearch('package.json', cwd);
  if (packageJsonPath === null) {
    error(`no package.json found in this directory or any of the parent directories.`);
    return 1;
  }
  const packageDir = path.dirname(packageJsonPath);

  const packageJson = await readJson(packageJsonPath) as JsonObject;

  let scripts: PackageJsonScripts = {};
  if (packageJson.scripts !== undefined) {
    if (!isObject(packageJson.scripts)) {
      error(`'scripts' field in package.json is not a JSON object`);
      return 1;
    }
    scripts = packageJson.scripts as PackageJsonScripts;
  }

  const tasksToRun = Object.keys(scripts)
    .filter(taskName => matchTaskName(taskName, expectedTaskNames));

  if (tasksToRun.length === 0) {
    error(Object.keys(scripts).length === 0
        ? `no tasks were defined in package.json. Specify tasks using the 'scripts' field.`
        : `no tasks matched the specified filter ${expectedTaskNames.map(taskName => `'${taskName}'`).join(' ')}.`);
    return 1;
  }

  const runTask = (taskName: string): Promise<number | null> => {

    const commandStr = scripts[taskName];

    if (commandStr === undefined) {
      error(`no task named '${taskName}' found.`)
      return Promise.resolve(1);
    }

    return evalShellCommand(commandStr, {
      cwd: packageDir,
      extraBuiltins: {
        async bake(argv) {
          return invoke(argv.slice(1));
        }
      },
      spawn: (args, opts) => {
        return spawnWithPrefix(args, {
          prefix: chalk.bold.white(` ${taskName} `),
          ...opts
        });
      },
    });

  }

  const exitCodes = await Promise.all(tasksToRun.map(runTask));

  if (exitCodes.some(code => code !== 0)) {
    error(`some tasks failed with a non-zero exit code.`);
    return 1;
  }

  verbose(`Bake completed the following tasks: ${expectedTaskNames.join(' ')}.`)

  return 0;

}

invoke(process.argv.slice(2)).then(exitCode => {
  process.exit(exitCode);
});

