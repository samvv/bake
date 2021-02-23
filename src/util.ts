
import fs from "fs-extra";
import path from "path";
import stream from "stream";
import cp from "child_process";

import { verbose } from "./logging";

export type JsonArray = Array<Json>;
export type JsonObject = { [key: string]: Json }
export type Json = null | boolean | number | string | JsonArray | JsonObject

export async function readJson(filePath: string): Promise<Json | null> {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

export function isObject(value: any) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

export function* getObjectEntries<O extends object>(obj: O): IterableIterator<[keyof O, O[keyof O]]> {
  for (const key of Object.keys(obj)) {
    yield [
      key as keyof O,
      obj[key as keyof O]
    ];
  }
}

export function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) {
    return value;
  }
  return value === null
      || value === undefined
    ? []
    : [ value ];
}

export async function upsearch(fileName: string, startDir: string = process.cwd()) {
  let currDir = startDir;
  for (;;) {
    const filePath = path.join(currDir, fileName);
    if (await fs.pathExists(filePath)) {
      return filePath;
    }
    const { dir, root } = path.parse(currDir);
    if (dir === root) {
      break;
    }
    currDir = dir;
  }
  return null;
}

export function splitShell(command: string): string[] {
  return command.split(' ');
}

export function splitLines(str: string): string[] {
  const lines = str.split('\n');
  if (lines[lines.length-1] === '') {
    lines.splice(lines.length-1, 1);
  }
  return lines;
}

interface PrefixTransformOptions extends stream.TransformOptions{
  prefix: string;
}

function isNewLine(ch: string): boolean {
  return ch === '\n';
}

export class PrefixTransformStream extends stream.Transform {

  private atBlankLine = true;
  private prefix: string;

  constructor({ prefix, ...opts }: PrefixTransformOptions) {
    super(opts);
    this.prefix = prefix;
  }

  _transform(chunk: any, encoding: BufferEncoding, callback: stream.TransformCallback) {
    if (encoding as string === 'buffer') {
      chunk = chunk.toString('utf8')
    }
    let out = '';
    for (const ch of chunk) {
      if (this.atBlankLine) {
        out += this.prefix;
      }
      this.atBlankLine = isNewLine(ch);
      out += ch;
    }
    this.push(out);
    callback();
  }

}

function isMember<T>(elements: Iterable<T>, needle: T): boolean {
  for (const element of elements) {
    if (element === needle) {
      return true;
    }
  }
  return false;
}

const SHELL_UNSAFE_REGEX =/[^\w@%+=:,.\/-]/;

// Function based on CPython's shlex.quote function.
// https://github.com/python/cpython/blob/3.9/Lib/shlex.py
function shellQuote(arg: string) { 
  if (arg.length === 0) {
    return "''";
  }
  if (SHELL_UNSAFE_REGEX.test(arg)) {
    return "'" + arg.replace("'",  "'\"'\"'") + "'"
  }
  return arg;
}

export function shellJoin(argv: string[]): string {
  return argv.map(shellQuote).join(' ');
}

interface SpawnResult {
  stderr: string | null;
  stdout: string | null;
  code: number | null;
}

type SpawnTarget = string | string[]

export interface RunCommandOptions extends cp.SpawnOptions {
  check?: boolean;
}

export function runCommand(commandOrArgv: SpawnTarget, {
  check = true,
  stdio = 'inherit',
  ...opts
}: RunCommandOptions = {}): Promise<SpawnResult> {

  let stdinMode;
  let stdoutMode;
  let stderrMode;

  let childProcess: cp.ChildProcess;
  let shellCommand: string;

  if (typeof(stdio) === 'string') {
    stdinMode = stdio;
    stdoutMode = stdio;
    stderrMode = stdio;
  } else if (Array.isArray(stdio)) {
    stdinMode = stdio[0];
    stdoutMode = stdio[1];
    stderrMode = stdio[2];
  }

  if (typeof(commandOrArgv) === 'string') {
    shellCommand = commandOrArgv;
    verbose(`Running ${shellCommand}`);
    childProcess = cp.spawn(commandOrArgv, {
      stdio,
      ...opts,
      shell: true,
    });
  } else {
    shellCommand = shellJoin(commandOrArgv);
    verbose(`Running ${shellCommand}`);
    childProcess = cp.spawn(commandOrArgv[0], commandOrArgv.slice(1), {
      stdio,
      ...opts
    });
  }

  let stdout: string | null = null;
  let stderr: string | null = null;

  if (stdoutMode === 'pipe') {
    stdout = '';
    childProcess.stdout!.setEncoding('utf8');
    childProcess.stdout!.on('data', chunk => {
      stdout += chunk;
    });
  }

  if (stderrMode === 'pipe') {
    stderr = '';
    childProcess.stderr!.setEncoding('utf8');
    childProcess.stderr!.on('data', chunk => {
      stderr += chunk;
    });
  }

  return new Promise(accept => {
    childProcess.on('exit', code => {
      if (check && code !== 0) {
        throw new Error(`Process ${shellCommand} exited with non-zero exit code ${code}.`);
      }
      accept({
        code,
        stdout,
        stderr,
      });
    });
  });

}
