#!/usr/bin/env node

import path from "path";
import cp from "child_process";
import fs from "fs";
import which from "which";

import Minimatch from "minimatch";
import yargs from "yargs";
import chalk from "chalk";

import {
  PrefixTransformStream,
  upsearch,
  readJson,
  isObject,
  shellJoin,
  getObjectEntries,
  toArray
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

async function pathExists(filepath: string) {
  try {
    await fs.promises.access(filepath, fs.constants.F_OK);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
  return true;
}

async function npmWhich(command: string, {
  startDir = process.cwd(),
}): Promise<string | null> {
  let currDir = startDir; 
  for (;;) {
    const binPath = path.join(currDir, 'node_modules', '.bin', command);
    if (await pathExists(binPath)) {
      return binPath;
    }
    const { root, dir } = path.parse(currDir);
    if (root === dir) {
      break;
    }
    currDir = dir;
  }
  return which(command);
}

function spawnWithPrefix(argv: string[], {
  cwd = process.cwd(),
  env = process.env,
  prefix = '',
}: SpawnOptions & { prefix?: string }): Promise<number | null> {

  return new Promise(async (accept, reject) => {

    const [progName, ...args] = argv;

    const progPath = await npmWhich(progName, { startDir: cwd });

    if (progPath === null) {
      throw new Error(`Command '${progName}' not found in node_modules or in PATH.`);
    }

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

interface InvokeOptions {
  cwd?: string;
}

function invoke(rawArgs: string[], { cwd }: InvokeOptions = {}): Promise<number> {

  return new Promise(accept => {

    yargs

      .command(

        '$0 [tasks..]', 'Run some scripts defined in package.json',

        yargs => yargs
          .describe('tasks', 'What tasks to run')
          .boolean('local')
          .describe('local', 'Allow using a local installation of Bake')
          .default('local', true)
          .string('work-dir')
          .describe('work-dir', 'Act as if run from this directory')
          .alias('C', 'work-dir')
          .default('work-dir', '.'),

        async (args) => {

          const expectedTaskNames = toArray(args.tasks as string | string[]);
          if (cwd === undefined) {
            cwd = path.resolve(args['work-dir'] as string);
          }
          const allowRespawn = args['local'];

          const bakeBinPath = await npmWhich('bake', { startDir: cwd });

          if (allowRespawn && bakeBinPath && fs.realpathSync(__filename) !== fs.realpathSync(bakeBinPath)) {
            verbose(`Re-spawning with local installation of Bake`);
            const exitCode = cp.spawnSync(bakeBinPath, [ '--no-local', ...rawArgs ], { stdio: 'inherit', }).status;
            accept(exitCode === null ? 1 : exitCode);
          }

          bake(expectedTaskNames, { cwd }).then(accept);

        }

      )

      .parse(rawArgs);

  });

}

function reinvoke(rawArgs: string[], opts: InvokeOptions = {}) {
  return invoke([ '--no-local', ...rawArgs ], opts);
}

async function bake(expectedTaskNames: string[], {
  cwd = process.cwd()
}): Promise<number> {

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
          reinvoke(argv.slice(1), { cwd: this.cwd }).then(next);
        },
        npm(argv, next) {
          if (argv[1] === 'run') {
            verbose(`Caught ${shellJoin(argv)}`);
            reinvoke(argv.slice(2), { cwd: this.cwd }).then(next);
          } else if (argv[1] === 'test' || argv[1] === 'start') {
            verbose(`Caught ${shellJoin(argv)}`);
            reinvoke(argv.slice(1), { cwd: this.cwd }).then(next);
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

