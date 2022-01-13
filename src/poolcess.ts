/**
 * Poolcess
 * A Promise Based Child Process Pool
 *
 * Author
 * Hugo Gonçalves - hfdsgoncalves@gmail.com
 */
import { ChildProcess, fork } from 'child_process';
import { EventEmitter2, Listener } from 'eventemitter2';

interface DataMap {
  dataType: string;
  value: unknown[];
}

class Task {
  public code: string;

  public context: Record<string, unknown>;

  public timeout: number;

  public args?: string;

  /**
   *
   * @param code The Javascript code to execute
   * @param context Context for the code. These will be serialized and made
   * available to the code.
   * @param timeout The execution timeout
   * @param args A Map of arguments to pass to the code
   */
  public constructor(
    code: string,
    context: Record<string, unknown>,
    timeout: number,
    args?: Map<string, unknown>,
  ) {
    this.code = code;
    this.context = context;
    this.timeout = timeout;
    this.args = JSON.stringify(
      args,
      (_key, value): DataMap | Map<string, unknown> => {
        if (value instanceof Map) {
          return {
            dataType: 'Map',
            value: Array.from(value.entries()),
          };
        } else {
          return value as Map<string, unknown>;
        }
      },
    );
  }
}

export enum TaskAbortReason {
  abort = 2,
  timeout = 3,
}

export interface IPoolcess {
  execTask: (
    taskId: string,
    code: string,
    context: Record<string, unknown>,
    timeout: number,
    args?: Map<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  abortTask: (taskId: string, code: number) => void;
}

export class Poolcess implements IPoolcess {
  private isDestroyed = false;

  private readonly tasks: Map<string, Task> = new Map();

  private readonly taskPid: Map<string, number> = new Map();

  private processes: ChildProcess[] = [];

  private readonly processCount: number;

  private readonly checkedInProcesses: Map<number, null> = new Map();

  private readonly events: EventEmitter2 | undefined;

  private readonly abortEvents: EventEmitter2 | undefined;

  private readonly taskOutputs: EventEmitter2 | undefined;

  /**
   *
   * @param processCount Number of processes in the pool
   */
  public constructor(processCount?: number) {
    this.events = new EventEmitter2({
      wildcard: false,
      delimiter: '.',
      newListener: false,
      removeListener: false,
      maxListeners: 1,
      verboseMemoryLeak: false,
      ignoreErrors: false,
    });
    this.abortEvents = new EventEmitter2({
      wildcard: false,
      delimiter: '.',
      newListener: false,
      removeListener: false,
      maxListeners: processCount != undefined ? processCount * 2 : 2,
      verboseMemoryLeak: false,
      ignoreErrors: false,
    });
    this.taskOutputs = new EventEmitter2({
      wildcard: false,
      delimiter: '.',
      newListener: false,
      removeListener: false,
      maxListeners: processCount != undefined ? processCount * 2 : 2,
      verboseMemoryLeak: false,
      ignoreErrors: false,
    });
    // Setup newTask listener
    this.events.on('newTask', (taskId: string): void => {
      if (!this.tasks.has(taskId)) return;
      const PROC = this.getProcess();
      if (PROC != undefined) {
        this.checkInProcess(PROC.pid ?? -1);
        // Available process
        // Setup abort event liteners
        this.abortEvents?.once(taskId, (reason: TaskAbortReason): void => {
          this.taskPid.delete(taskId);
          this.tasks.delete(taskId);
          if (reason === TaskAbortReason.abort) {
            this.taskOutputs
              ?.emitAsync(taskId, { error: 'User Aborted.' })
              .catch((error: Error): void => {
                this.destroy();
                throw error;
              });
          } else {
            this.taskOutputs
              ?.emitAsync(taskId, { error: 'Timeout.' })
              .catch((error: Error): void => {
                this.destroy();
                throw error;
              });
          }
          this.maintainMinimumProcesses();
        });
        this.taskPid.set(taskId, PROC.pid ?? -1);
        PROC.send({ id: taskId, task: this.tasks.get(taskId) });
      } else {
        // No process available, process later on
        this.events
          ?.emitAsync('newTask', taskId)
          .catch((error: Error): void => {
            this.destroy();
            throw error;
          });
      }
    });

    // Fork the required processes and set message listeners
    if (processCount != undefined) {
      this.processCount = processCount;
      for (let i = 0; i < processCount; i++) {
        const PROC = fork(__dirname + '/worker.js', [], { silent: true });
        PROC.on('message', (data: Record<string, unknown>): void => {
          this.taskOutputs
            ?.emitAsync(data.id as string, data.context)
            .catch((error: Error): void => {
              this.destroy();
              throw error;
            });
          this.taskPid.delete(data.id as string);
          this.tasks.delete(data.id as string);
          this.checkOutProcess(PROC.pid ?? -1);
        });
        this.processes.push(PROC);
      }
    } else {
      this.processCount = 1;
      const PROC = fork(__dirname + '/worker.js', [], { silent: true });
      PROC.on('message', (data: Record<string, unknown>): void => {
        this.taskOutputs
          ?.emitAsync(data.id as string, data.context)
          .catch((error: Error): void => {
            this.destroy();
            throw error;
          });
        this.taskPid.delete(data.id as string);
        this.tasks.delete(data.id as string);
        this.checkOutProcess(PROC.pid ?? -1);
      });
      this.processes.push(PROC);
    }
  }

  /**
   * Adds a new task to be processed and returns a promise that resolves to
   * the code context
   * @param code The Javascript code to execute
   * @param context Context for the code. These will be serialized and made
   * available to the code.
   * @param timeout The execution timeout
   * @param args A Map of arguments to pass to the code
   * @returns A Promise that resolves to the Task Id or rejects
   */
  public async execTask(
    taskId: string,
    code: string,
    context: Record<string, unknown>,
    timeout: number,
    args?: Map<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (this.isDestroyed) throw new Error('Pool is destroyed.');
    let timeoutcb: NodeJS.Timeout | undefined = undefined;
    return Promise.race<Record<string, unknown>>([
      new Promise((resolve, reject): void => {
        this.tasks.set(taskId, new Task(code, context, timeout, args));
        const LISTENER = this.taskOutputs?.once(
          taskId,
          (res: Record<string, unknown>): void => {
            if (res.error != undefined) {
              if (timeoutcb != undefined) clearTimeout(timeoutcb);
              reject(res);
            } else {
              if (timeoutcb != undefined) clearTimeout(timeoutcb);
              resolve(res);
            }
          },
        );
        this.events
          ?.emitAsync('newTask', taskId)
          .catch((error: Error): void => {
            reject(error);
            (LISTENER as Listener).off();
          });
      }),
      new Promise((): void => {
        timeoutcb = setTimeout((): void => {
          this.abortTask(taskId, TaskAbortReason.timeout);
        }, timeout);
      }),
    ]);
  }

  /**
   * Aborts the given task. Removes the task from the queue or aborts the
   * execution if already started.
   * @param taskId The task id to abort
   * @param reason The reason for aborting the task
   */
  public abortTask(taskId: string, reason: TaskAbortReason): void {
    if (this.isDestroyed) throw new Error('Pool is destroyed.');
    if (this.taskPid.has(taskId)) {
      const PID = this.taskPid.get(taskId);
      for (const PROC of this.processes) {
        if (PROC.pid === PID) {
          PROC.kill();
          this.checkOutProcess(PROC.pid ?? -1);
        }
      }
      this.abortEvents
        ?.emitAsync(taskId, reason)
        .catch((error: Error): void => {
          this.destroy();
          throw error;
        });
      this.maintainMinimumProcesses();
    } else if (this.tasks.has(taskId)) {
      this.tasks.delete(taskId);
    }
  }

  /**
   * Counts the number of active processes
   * @returns Number of active processes
   */
  public getActiveProcessesCount(): number {
    if (this.isDestroyed) throw new Error('Pool is destroyed.');
    let count = 0;
    for (const PROC of this.processes) if (!PROC.killed) count++;
    return count;
  }

  /**
   * Kill all processes and remove any pending tasks.
   */
  public destroy(): void {
    if (this.isDestroyed) throw new Error('Pool is destroyed already.');
    this.isDestroyed = true;
    // Abort all tasks so their promises get rejected
    for (const TASKID of this.tasks.keys()) {
      this.abortEvents
        ?.emitAsync(TASKID, TaskAbortReason.abort)
        .catch((error: Error): void => {
          console.log(error);
        });
    }
    // Kill all cps
    for (const PROC of this.processes) if (!PROC.killed) PROC.kill();

    // Clear
    this.taskPid.clear();
    this.tasks.clear();
    this.events?.removeAllListeners();
    this.abortEvents?.removeAllListeners();
    this.taskOutputs?.removeAllListeners();
  }

  /**
   * Checks if there is any available process and returns it. Otherwise returns
   * undefined.
   * @returns ChildProcess
   */
  private getProcess(): ChildProcess | undefined {
    for (const PROC of this.processes) {
      if (!this.checkedInProcesses.has(PROC.pid ?? -1) && !PROC.killed)
        return PROC;
    }
    return undefined;
  }

  /**
   * Checks in a Process, making it unavailable for further task processing
   * @param pid Process Id
   */
  private checkInProcess(pid: number): void {
    this.checkedInProcesses.set(pid, null);
  }

  /**
   * Checks out a Process, making it available for further task processing
   * @param pid Process Id
   */
  private checkOutProcess(pid: number): void {
    if (this.checkedInProcesses.has(pid)) this.checkedInProcesses.delete(pid);
  }

  /**
   * Ensures the required number of processes are available
   */
  private maintainMinimumProcesses(): void {
    // Filter out any killed cps
    for (const PROC of this.processes) {
      if (PROC.killed) {
        this.processes = this.processes.filter((item): boolean => {
          if (item.pid !== PROC.pid) return true;
          return false;
        });
      }
    }
    // Fork more cps if needed
    if (this.processes.length < this.processCount) {
      for (let i = this.processes.length; i < this.processCount; i++) {
        const PROC = fork(__dirname + '/worker.js', [], { silent: true });
        PROC.on('message', (data: Record<string, unknown>): void => {
          this.taskOutputs
            ?.emitAsync(data.id as string, data.context)
            .catch((error: Error): void => {
              this.destroy();
              throw error;
            });
          this.taskPid.delete(data.id as string);
          this.tasks.delete(data.id as string);
          this.checkOutProcess(PROC.pid ?? -1);
        });
        this.processes.push(PROC);
      }
    }
  }
}
