#!/usr/bin/env node

import path from "path";
import yargs from "yargs";
import Minimatch from "minimatch";
import { PrefixTransformStream, toArray, upsearch, readJson, JsonObject, isObject } from "../util";
import { error, info } from "../logging";
import { TmuxSession } from "../tmux";
import { spawn } from "child_process";
import chalk from "chalk";

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

type PackageJsonScripts = { [name: string]: string }

yargs
  .command(
    '$0 [tasks..]',
    'Run tasks',
    yargs => yargs
      .string('work-dir')
      .describe('work-dir', 'Act as if run from this directory')
      .default('work-dir', '.')
      .alias('work-dir', 'C')
      .choices('spawn-mode', [ 'tmux', 'node' ])
      .describe('spawn-mode', 'Which program to use to manage the processes')
      .default('spawn-mode', 'node'),
    async (args) => {

      const mode = args['spawn-mode'];
      const expectedTaskNames = toArray(args.tasks as string | string[]);
      const cwd = path.resolve(args['work-dir']);

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

      const tasks = [];
      for (const taskName of Object.keys(scripts)) {
        if (matchTaskName(taskName, expectedTaskNames)) {
          tasks.push({
            type: 'shell',
            name: taskName,
            shellCommand: scripts[taskName],
          });
        }
      }

      if (tasks.length === 0) {
        error(expectedTaskNames.length === 0
            ? `no tasks were defined in package.json. Specify tasks using the 'scripts' field.`
            : `no tasks matched the specified filter.`);
        return 1;
      }

      if (mode === 'tmux') {

        const tmux = new TmuxSession({
          sessionName: 'bake-' + packageJson.name,
        });

        for (const task of tasks) {
          let win = await tmux.findWindowByName(task.name);
          if (win === null) {
            info(` • Launching task '${task.name}'`);
            await tmux.createWindow({
              name: task.name,
              detach: true,
              shellCommand: task.shellCommand,
            });
          }
        }

      } else if (mode === 'node') {

        for (const task of tasks) {
          const childProcess = spawn(task.shellCommand, {
            shell: true,
            cwd: packageDir,
            stdio: [ 'inherit', 'pipe', 'pipe' ]
          })
          childProcess.stdout
            .pipe(new PrefixTransformStream({
              prefix: chalk.bold.white(` ${task.name} `)
            }))
            .pipe(process.stdout)
          childProcess.stderr
            .pipe(new PrefixTransformStream({
              prefix: chalk.bold.white(` ${task.name} `)
            }))
            .pipe(process.stderr)
        }

      } else {

        error(`Invalid --spawn-mode given. Exiting.`);
        return 1;

      }

    }
  )
  .argv

