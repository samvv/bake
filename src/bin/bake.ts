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
  isObject,
  shellJoin,
  getObjectEntries
} from "../util";

import {
  error,
  verbose
} from "../logging";

import {
  evalShellCommand,
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

class CLIError extends Error {

}

interface PackageJson {
  name: string;
  version: string;
  description?: string;
  scripts?: PackageJsonScripts;
  workspaces?: PackageJsonWorkspaces;
}

type PackageJsonScripts = { [name: string]: string }
type PackageJsonWorkspaces = string[];

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

interface InvokeOptions {
  /**
   * Overrides the current working directory of this invocation. Note that even
   * if --work-dir=/path/to/foo is provided in the arguments this option will
   * get priority.
   */
  cwd?: string;
  /**
   * Whether to give a warning when the user ran Bake and nothing happened.
   */
  ignoreEmptyScripts?: boolean;
}

interface TaskInfo {
  name: string;
  shellCommand: string;
  cwd: string;
}

async function* loadTasks(packageDir: string): AsyncGenerator<TaskInfo> {
  const packageJson = await readJson(path.join(packageDir, 'package.json')) as unknown as PackageJson;
  if (packageJson.scripts === undefined) {
    return [];
  }
  if (!isObject(packageJson.scripts)) {
    throw new CLIError(`'scripts' field in package.json is not a JSON object`);
  }
  for (const [scriptName, shellCommand] of getObjectEntries(packageJson.scripts)) {
    yield {
      name: scriptName as string,
      cwd: packageDir,
      shellCommand,
    }
  }
}

async function invoke(args: string[]): Promise<number> {

  let cwd = process.cwd();
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
        if (cwd === undefined) {
          cwd = path.resolve(flagValue);
        }
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
    const exitCode = cp.spawnSync(bakeBinPath, args, { stdio: 'inherit', }).status;
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

  const packageJson = await readJson(packageJsonPath) as unknown as PackageJson;

  const tasks = [];

  if (packageJson.workspaces !== undefined) {
    for (const workspaceDir of packageJson.workspaces) {
      for await (const task of loadTasks(path.join(packageDir, workspaceDir))) {
        tasks.push(task);
      }
    }
  } else {
    for await (const task of loadTasks(packageDir)) {
      tasks.push(task);
    }
  }

  const tasksToRun = tasks.filter(task =>
    matchTaskName(task.name, expectedTaskNames));

  if (tasksToRun.length === 0) {
    error(packageJson.workspaces === undefined
            && (packageJson.scripts === undefined || Object.keys(packageJson.scripts).length === 0)
        ? `no tasks were defined in package.json. Specify tasks using the 'scripts' field.`
        : `no tasks matched the specified filter ${expectedTaskNames.map(taskName => `'${taskName}'`).join(' ')}.`);
    return 1;
  }

  const runTask = (task: TaskInfo): Promise<number | null> => {

    return evalShellCommand(task.shellCommand, {
      cwd: task.cwd,
      extraBuiltins: {
        bake(argv, next) {
          verbose(`Caught ${shellJoin(argv)}`);
          invoke(argv.slice(1)).then(next);
        },
        npm(argv, next) {
          if (argv[1] === 'run') {
            verbose(`Caught ${shellJoin(argv)}`);
            invoke(argv.slice(2)).then(next);
          } else if (argv[1] === 'test' || argv[1] === 'start') {
            verbose(`Caught ${shellJoin(argv)}`);
            invoke(argv.slice(1)).then(next);
          } else {
            this.spawn(argv).then(next);
          }
        }
      },
      spawn: (args, opts) => {
        return spawnWithPrefix(args, {
          prefix: chalk.bold.white(` ${task.name} `),
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

