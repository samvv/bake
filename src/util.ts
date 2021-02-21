
import { cyanBright } from "chalk";
import fs from "fs-extra";
import path from "path";
import stream from "stream";

export type JsonArray = Array<Json>;
export type JsonObject = { [key: string]: Json }
export type Json = null | boolean | number | string | JsonArray | JsonObject

export async function readJson(filePath: string): Promise<Json | null> {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

export function isObject(value: any) {
  return Object.prototype.toString.call(value) === '[object Object]';
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
    if (fs.pathExists(filePath)) {
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