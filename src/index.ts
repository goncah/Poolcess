/**
 * Poolcess
 * A Promise Based Child Process Pool
 *
 * Author
 * Hugo Gonçalves - hfdsgoncalves@gmail.com
 */
import * as cp from 'child_process';
import { EventEmitter } from 'events';

class Task {
  public code: string;
  public context: Hashmap;
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
  constructor(
    code: string,
    context: Hashmap,
    timeout: number,
    args?: Map<string, any>,
  ) {
    this.code = code;
    this.context = context;
    this.timeout = timeout;
    this.args = JSON.stringify(args, this.replacer);
  }

  /**
   * To allow the serialization of Maps
   */
  private replacer(key: string, value: any) {
    if (value instanceof Map) {
      return {
        dataType: 'Map',
        value: Array.from(value.entries()),
      };
    } else {
      return value;
    }
  }
}

export enum TaskAbortReason {
  ABORT = 2,
  TIMEOUT = 3,
}

export interface Hashmap {
  [key: string]: any;
}

export interface IPoolcess {
  execTask(
    taskId: string,
    code: string,
    context: Hashmap,
    timeout: number,
    ...args: any
  ): Promise<Hashmap>;
  abortTask(taskId: string, code: number): Promise<void>;
}

export class Poolcess implements IPoolcess {
  private isDestroyed = false;
  private tasks: Map<string, Task> = new Map(); // Holds tasks to process
  private taskPid: Map<string, number> = new Map(); // Holds task cp pid
  private processes: cp.ChildProcess[] = []; // Holds the forked cps
  private processCount = 0; // Init cp count
  private checkedInProcesses: Map<number, null> = new Map(); // Holds busy cps
  private events: EventEmitter = new EventEmitter(); // Emits new task events
  private abortEvents: EventEmitter = new EventEmitter(); // Emits abort events
  private taskOutputs: EventEmitter = new EventEmitter(); // Emits task outputs

  /**
   *
   * @param processCount Number of processes in the pool
   */
  constructor(processCount?: number) {
    this.events.setMaxListeners(this.processCount + 1);
    this.abortEvents.setMaxListeners(this.processCount + 1);
    this.taskOutputs.setMaxListeners(this.processCount + 1);
    // Setup newTask listener
    this.events.on('newTask', (taskId: string) => {
      if (!this.tasks.has(taskId)) return;
      this.getProcess().then((proc) => {
        if (proc != undefined) {
          this.checkInProcess(proc.pid ?? -1);
          // Available process
          // Setup abort event liteners
          this.abortEvents.once(taskId, (reason) => {
            this.taskPid.delete(taskId);
            this.tasks.delete(taskId);
            if (reason === TaskAbortReason.ABORT) {
              this.taskOutputs.emit(taskId, { error: 'User Aborted.' });
            } else if (reason === TaskAbortReason.TIMEOUT) {
              this.taskOutputs.emit(taskId, { error: 'Timeout.' });
            } else {
              this.taskOutputs.emit(taskId, { error: 'Unknown error.' });
            }
            this.maintainMinimumProcesses();
          });
          this.taskPid.set(taskId, proc.pid ?? -1);
          proc.send({ id: taskId, task: this.tasks.get(taskId) });
        } else {
          // No process available, process later on
          this.events.emit('newTask', taskId);
        }
      });
    });

    // Fork the required processes and set message listeners
    if (processCount != undefined) {
      this.processCount = processCount;
      for (let i = 0; i < processCount; i++) {
        const proc = cp.fork(__dirname + '/worker.js', [], { silent: true });
        proc.on('message', (data: any) => {
          this.taskOutputs.emit(data.id, data.context);
          this.taskPid.delete(data.id);
          this.tasks.delete(data.id);
          this.checkOutProcess(proc.pid ?? -1);
        });
        this.processes.push(proc);
      }
    } else {
      this.processCount = 1;
      const proc = cp.fork(__dirname + '/worker.js', [], { silent: true });
      proc.on('message', (data: any) => {
        this.taskOutputs.emit(data.id, data.context);
        this.taskPid.delete(data.id);
        this.tasks.delete(data.id);
        this.checkOutProcess(proc.pid ?? -1);
      });
      this.processes.push(proc);
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
    context: Hashmap,
    timeout: number,
    args?: Map<string, any>,
  ): Promise<Hashmap> {
    if (this.isDestroyed) throw new Error('Pool is destroyed.');
    let timeoutcb: NodeJS.Timeout;
    return Promise.race<Hashmap>([
      new Promise((resolve, reject) => {
        this.tasks.set(taskId, new Task(code, context, timeout, args));
        this.taskOutputs.on(taskId, (res) => {
          if (res.error != undefined) {
            clearTimeout(timeoutcb);
            reject(res);
          } else {
            clearTimeout(timeoutcb);
            resolve(res);
          }
        });
        this.events.emit('newTask', taskId);
      }),
      new Promise(() => {
        timeoutcb = setTimeout(() => {
          this.abortTask(taskId, TaskAbortReason.TIMEOUT);
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
  public async abortTask(
    taskId: string,
    reason: TaskAbortReason,
  ): Promise<void> {
    if (this.isDestroyed) throw new Error('Pool is destroyed.');
    if (this.taskPid.has(taskId)) {
      const pid = this.taskPid.get(taskId);
      for (const proc of this.processes) {
        if (proc.pid === pid) {
          proc.kill();
          this.checkOutProcess(proc.pid ?? -1);
        }
      }
      this.abortEvents.emit(taskId, reason);
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
    for (const proc of this.processes) if (!proc.killed) count++;
    return count;
  }

  /**
   * Kill all processes and remove any pending tasks.
   */
  public destroy(): void {
    if (this.isDestroyed) throw new Error('Pool is destroyed already.');
    this.isDestroyed = true;
    // Abort all tasks so their promises get rejected
    for (const taskId of this.tasks.keys()) {
      this.abortEvents.emit(taskId, TaskAbortReason.ABORT);
    }
    // Kill all cps
    for (const proc of this.processes) if (!proc.killed) proc.kill();

    // Clear
    this.taskPid.clear();
    this.tasks.clear();
    this.events.removeAllListeners();
    this.abortEvents.removeAllListeners();
    this.taskOutputs.removeAllListeners();
  }

  /**
   * Checks if there is any available process and returns it. Otherwise returns
   * undefined.
   * @returns ChildProcess
   */
  private async getProcess(): Promise<cp.ChildProcess | undefined> {
    for (const proc of this.processes) {
      if (!this.checkedInProcesses.has(proc.pid ?? -1) && !proc.killed)
        return proc;
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
  private async maintainMinimumProcesses(): Promise<void> {
    // Filter out any killed cps
    for (const proc of this.processes) {
      if (proc.killed) {
        this.processes = this.processes.filter((item) => {
          if (item.pid !== proc.pid) {
            return true;
          }
        });
      }
    }
    // Fork more cps if needed
    if (this.processes.length < this.processCount) {
      for (let i = this.processes.length; i < this.processCount; i++) {
        const proc = cp.fork(__dirname + '/worker.js', [], { silent: true });
        proc.on('message', (data: any) => {
          this.taskOutputs.emit(data.id, data.context);
          this.taskPid.delete(data.id);
          this.tasks.delete(data.id);
          this.checkOutProcess(proc.pid ?? -1);
        });
        this.processes.push(proc);
      }
    }
  }
}
