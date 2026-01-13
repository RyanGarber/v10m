import { spawn } from 'child_process';

type Stream = 'stdout' | 'stderr';
type StreamList = Stream[];

export interface CommandOptions {
  captureOutput: StreamList;
  captureError: StreamList;
  treatAsError: (line: string) => boolean;
  onError: number;
}

export enum CommandEvent {
  Data = 'data',
  Error = 'error',
}

export enum ErrorMode {
  None = 0,
  Stop = 1,
  Reject = 2,
}

export class Command extends EventTarget {
  private options: CommandOptions;
  private output = '';
  private stopped = false;

  constructor(
    private command: string[],
    options: Partial<CommandOptions> = {}
  ) {
    super();
    this.options = {
      captureOutput: options.captureOutput ?? ['stdout'],
      captureError: options.captureError ?? ['stderr'],
      treatAsError: options.treatAsError ?? (() => false),
      onError: options.onError ?? ErrorMode.Stop | ErrorMode.Reject,
    };
  }

  on(event: CommandEvent, callback: (data: string) => void) {
    this.addEventListener(event, (event: Event) =>
      callback((event as CustomEvent).detail as string)
    );
    return this;
  }

  private emit(event: CommandEvent, data: string) {
    this.dispatchEvent(new CustomEvent(event, { detail: data }));
  }

  run(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.output = '';
      this.stopped = false;

      const executable = this.command[0];
      const args = this.command.slice(1);

      const process = spawn(executable, args);

      const streams = {
        stdout: process.stdout,
        stderr: process.stderr,
      };

      for (const [streamName, stream] of Object.entries(streams)) {
        stream.on('data', (data: Buffer) => {
          if (this.stopped) {
            return;
          }
          if (this.options.captureOutput.includes(streamName as Stream)) {
            this.emit(CommandEvent.Data, data.toString());
            this.output += data.toString();
          }
          if (
            this.options.captureError.includes(streamName as Stream) ||
            this.options.treatAsError(data.toString())
          ) {
            this.emit(CommandEvent.Error, data.toString());
            if (this.options.onError & ErrorMode.Stop) {
              this.stopped = true;
              try {
                process.kill();
              } catch (e: unknown) {
                console.log(`Failed to kill process: ${String(e)}`);
              }
            }
            if (this.options.onError & ErrorMode.Reject) {
              reject(new Error(data.toString()));
            }
          }
        });
      }

      process.on('close', (code) => {
        if (code === 0) {
          resolve(this.output);
        } else {
          if (this.options.onError & ErrorMode.Reject) {
            reject(new Error(`Command failed with exit code ${code}: ${this.output}`));
          } else {
            resolve(this.output);
          }
        }
      });

      process.on('error', (error) => {
        this.emit(CommandEvent.Error, error.toString());
        reject(error);
      });
    });
  }
}
