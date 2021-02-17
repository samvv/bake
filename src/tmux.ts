import { runCommand, RunCommandOptions } from "./shell";
import {splitLines} from "./util";

export interface TmuxWindowOptions {
  name?: string;
  detach?: boolean;
  shellCommand?: string;
}

export interface TmuxSessionOptions {
  sessionName?: string;
}

export class TmuxSession {

  private sessionId: string | null = null;
  private sessionName: string | null;

  constructor({
    sessionName
  }: TmuxSessionOptions = {}) {
    this.sessionName = sessionName ?? null;
  }

  private execute(argv: string[], {
    stdio = 'inherit',
    ...opts
  }: RunCommandOptions = {}) {
    return runCommand([ 'tmux', ...argv ], {
      stdio,
      ...opts
    })
  }

  private async detectSessionId() {

    if (this.sessionId === null && this.sessionName !== null) {

      const listSessionsResult = await this.execute([ 'list-sessions', '-F', '#{session_id}=#{session_name}' ], { stdio: ['ignore', 'pipe', 'ignore'], check: false })

      if (listSessionsResult.code === 0) {
        for (const line of splitLines(listSessionsResult.stdout!)) {
          const [id, name] = line.split('=');
          if (name === this.sessionName) {
            this.sessionId = id;
          }
        }
      }

    }

    return this.sessionId;
  }

  public async findWindowByName(windowName: string) {

    const sessionId = await this.detectSessionId();

    const listWindowsArgv = [ 'list-windows', '-F', '#{window_id}=#{window_name}' ];

    if (sessionId !== null) {
      listWindowsArgv.push('-t');
      listWindowsArgv.push(sessionId);
    }

    const listWindowsResult = await this.execute(listWindowsArgv, { stdio: [ 'ignore', 'pipe', 'ignore' ], check: false });

    if (listWindowsResult.code !== 0) {
      return null;
    }

    for (const line of splitLines(listWindowsResult.stdout!)) {
      const [id, name] = line.split('=');
      if (name === windowName) {
        return id;
      }
    }

    return null;
  }

  public async createWindow(options: TmuxWindowOptions) {

    const sessionId = await this.detectSessionId();

    if (sessionId !== null) {

      const newWindowArgv = [ 'new-window', '-d' ]

      newWindowArgv.push('-t')
      newWindowArgv.push(sessionId);

      if (options.name !== undefined) {
        newWindowArgv.push('-n')
        newWindowArgv.push(options.name);
      }

      if (options.shellCommand !== undefined) {
        newWindowArgv.push(options.shellCommand);
      }

      await this.execute(newWindowArgv)

    } else {

      const newSessionArgv = [ 'new-session', '-d' ];

      if (this.sessionName !== null) {
        newSessionArgv.push('-s')
        newSessionArgv.push(this.sessionName);
      }

      if (options.name !== undefined) {
        newSessionArgv.push('-n')
        newSessionArgv.push(options.name);
      }

      if (options.shellCommand !== undefined) {
        newSessionArgv.push(options.shellCommand);
      }

      await this.execute(newSessionArgv);

    }

  }

  public async exists(): Promise<boolean> {
    return (await this.execute([ 'info' ], { stdio: 'ignore', check: false })).code === 0;
  }

}
