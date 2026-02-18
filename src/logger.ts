type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

function timestamp(): string {
  return new Date().toISOString();
}

function log(level: LogLevel, module: string, message: string, data?: unknown): void {
  const prefix = `[${timestamp()}] [${level}] [${module}]`;
  if (data !== undefined) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

export function createLogger(module: string) {
  return {
    info: (msg: string, data?: unknown) => log('INFO', module, msg, data),
    warn: (msg: string, data?: unknown) => log('WARN', module, msg, data),
    error: (msg: string, data?: unknown) => log('ERROR', module, msg, data),
    debug: (msg: string, data?: unknown) => log('DEBUG', module, msg, data),
  };
}
