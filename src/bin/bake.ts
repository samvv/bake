#!/usr/bin/env node

import path from "path";
import yargs from "yargs";
import Minimatch from "minimatch";
import { toArray, upsearch, readJson, JsonObject, isObject } from "../util";
import { error } from "../logging";
import {TmuxSession} from "../tmux";

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
      .alias('work-dir', 'C'),
    async (args) => {

      const expectedTaskNames = toArray(args.tasks as string | string[]);
      const cwd = path.resolve(args['work-dir']);

      const packageJsonPath = await upsearch('package.json', cwd);
      if (packageJsonPath === null) {
        error(`no package.json found in this directory or any of the parent directories.`);
        return 1;
      }

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
        if (expectedTaskNames.length === 0) {
          error(`no tasks were defined in package.json. Specify tasks using the 'scripts' field.`);
        } else {
          error(`no tasks matched the specified filter.`);
        }
        return 1;
      }

      const tmux = new TmuxSession({
        sessionName: 'bake-' + packageJson.name,
      });

      for (const task of tasks) {
        let win = await tmux.findWindowByName(task.name);
        if (win === null) {
          await tmux.createWindow({
            name: task.name,
            detach: true,
            shellCommand: task.shellCommand,
          });
        }
      }

    }
  )
  .argv

