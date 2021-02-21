
const isDebug = process.env['NODE_ENV'] === 'development';

export function error(message: string): void {
  console.error(`Error: ${message}`);
}

export function verbose(message: string): void {
  if (isDebug) {
    console.info(message);
  }
}

export function info(message: string): void {
  console.info(message);
}

