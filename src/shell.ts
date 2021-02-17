
import cp from "child_process";

import { verbose } from "./logging";

export function shellSplit(command: string): string[] {
  // FIXME This isn't correct and won't work for a lot of commands
  return command.split(' ');
}

export function shellJoin(argv: string[]): string {
  return argv.join(' ');
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

