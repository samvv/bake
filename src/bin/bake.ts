#!/usr/bin/env node

import path from "path";
import cp from "child_process";

import npmWhich from "npm-which";
import yargs from "yargs";
import Minimatch from "minimatch";
import chalk from "chalk";

import {
  PrefixTransformStream,
  toArray,
  upsearch,
  readJson,
  JsonObject,
  isObject,
  shellJoin
} from "../util";
import {
  error,
  info
} from "../logging";
import {
  evalShellCommand,
  ShellCommand,
  SpawnOptions
} from "../shell";

function isEmpty(iterable: Iterable<any>): boolean {
  return iterable[Symbol.iterator]().next().done!;
}

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

interface TaskInfo {
  type: 'spawn';
  name: string;
  command: ShellCommand;
  before: string[];
  after: string[];
  checkExitCode: boolean;
  shouldFail: boolean;
}

type PackageJsonScripts = { [name: string]: string }

yargs
  .command(
    '$0 [tasks..]',
    'Run tasks',
    yargs => yargs
      .string('work-dir')
      .describe('work-dir', 'Act as if run from this directory')
      .default('work-dir', '.')
      .alias('work-dir', 'C'),
    async (args) => {

      const expectedTaskNames = toArray(args.tasks as string | string[]);
      const cwd = path.resolve(args['work-dir']);

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
            : `no tasks matched the specified filter.`);
        return 1;
      }

      let didSpawnProcess = false;

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
              const exitCodes = await Promise.all(argv.slice(1).map(runTask));
              return exitCodes.every(code => code === 0)
                  ? 0 : 1;
            }
          },
          spawn: (args, opts) => {
            didSpawnProcess = true;
            return spawnWithPrefix(args, {
              prefix: chalk.bold.white(` ${taskName} `),
              ...opts
            });
          },
        });

      }

      const exitCodes = await Promise.all(tasksToRun.map(runTask));

      if (exitCodes.some(code => code !== 0)) {
        error(`Some tasks failed with a non-zero exit code.`);
        return 1;
      }

      // When the user runs bake, it is reasonable to expect that she/he wants
      // someting to happen. For this reason we inform the user when nothing
      // is run.
      if (!didSpawnProcess) {
        info(`no processes were spawned during the invocation of Bake`);
      }

      info(`Build completed.`)

          //const visit = (
          //  node: ShellCommand,
          //  dependencies: TaskInfo[],
          //  checkExitCode = true,
          //  shouldFail = false
          //): TaskInfo[] => {

          //  switch (node.type) {

          //    case ShellNodeType.SpawnCommand:

          //      if (node.args[0].length === 1
          //        && node.args[0][0].type === ShellNodeType.TextExpr
          //        && node.args[0][0].text === 'bake') {

          //      }

          //      return [{
          //        type: 'spawn',
          //        name: taskName as string,
          //        command: node,
          //        before: dependencies.map(dep => dep.name),
          //        after: [],
          //        checkExitCode,
          //        shouldFail,
          //      }];

          //    case ShellNodeType.AndCommand:
          //      {
          //        const beforeTasks = visit(node.left, dependencies, true, shouldFail);
          //        return visit(node.right, beforeTasks);
          //      }

          //    case ShellNodeType.OrCommand:
          //      {
          //        const beforeTasks = visit(node.left, dependencies, false, shouldFail);
          //        return visit(node.right, beforeTasks);
          //      }

          //    case ShellNodeType.NotCommand:
          //      return visit(node.command, dependencies, checkExitCode, !shouldFail);

          //  }

      //    }

      //    visit(command, []);

      //  }

      //}

      // Index tasks by their name. This is needed because task.before and
      // task.after reference other tasks by their name alone.
      //const tasksByName = Object.create(null);
      //for (const task of tasks) {
      //  tasksByName[task.name] = task;
      //}

      //// Build a simple graph where task.before and task.after are merged
      //// together into the same edges.
      //const taskGraph = new StringGraph()
      //for (const task of tasks) {
      //  taskGraph.addVertex(task.name);
      //  for (const beforeTaskName of task.before) {
      //    taskGraph.addEdge(task.name, beforeTaskName);
      //  }
      //  for (const afterTaskName of task.after) {
      //    taskGraph.addEdge(afterTaskName, task.name);
      //  }
      //}

      //const runTaskChain = async (tasks: TaskInfo[]) => {

      //  // Run the tasks and halt if there was any kind of error. runTask()
      //  // should be responsible for reporting the correct error message.
      //  try {
      //    await Promise.all(tasks.map(task => runTask(task, { cwd: packageDir })));
      //  } catch (e) {
      //    return;
      //  }

      //  // Calculate the next tasks that should be run simply by traversing
      //  // the graph.
      //  const nextTasks: TaskInfo[] = [];
      //  for (const task of tasks) {
      //    for (const taskName of taskGraph.getIncoming(task.name)) {
      //        const task = tasksByName[taskName];
      //        nextTasks.push(task);
      //    }
      //  }

      //  // Ready to process the next batch of tasks.
      //  await runTaskChain(nextTasks);

      //}

      //// Find the tasks that have no dependencies and launch them first. If
      //// they completed, runTaskChain() will automatically make sure the next
      //// tasks are run.
      //await Promise.all(
      //  tasks
      //    .filter(task => isEmpty(taskGraph.getOutgoing(task.name)))
      //    .map(task => runTaskChain([ task ]))
      //)

    }
  )
  .argv

