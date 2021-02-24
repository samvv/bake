import chalk from "chalk";

const isDebug = process.env['NODE_ENV'] === 'development';

export function error(message: string): void {
  console.error(chalk.bold.red(` error `) + message);
}

export function verbose(message: string): void {
  if (isDebug) {
    console.info(chalk.bold.magenta(' verb ') + message);
  }
}

export function info(message: string): void {
  console.info(chalk.bold.yellow(' info ') + message);
}

