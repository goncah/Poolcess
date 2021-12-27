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

  /**
   *
   * @param code The Javascript code to execute
   * @param context Context for the code. These will be serialized and made
   * available to the code.
   * @param timeout The execution timeout
   */
  constructor(code: string, context: Hashmap, timeout: number) {
    this.code = code;
    this.context = context;
    this.timeout = timeout;
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
  ): Promise<Hashmap>;
  abortTask(taskId: string, code: number): Promise<void>;
}

export class Poolcess implements IPoolcess {
  private isDestroyed = false;
  private tasks: Map<string, Task> = new Map();
  private taskPid: Map<string, number> = new Map();
  private processes: cp.ChildProcess[] = [];
  private processCount = 0;
  private checkedInProcesses: Map<number, null> = new Map();
  private events: EventEmitter = new EventEmitter();
  private abortEvents: EventEmitter = new EventEmitter();
  private taskOutputs: EventEmitter = new EventEmitter();

  /**
   *
   * @param processCount Number of processes in the pool
   */
  constructor(processCount?: number) {
    // Setup newTask listener
    this.events.on('newTask', (taskId: string) => {
      if (!this.tasks.has(taskId)) return;
      this.getProcess().then((proc) => {
        if (proc != undefined) {
          this.checkInProcess(proc.pid);
          // Available process
          // Setup process listener
          this.abortEvents.on(taskId, (reason) => {
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
          proc.on('message', (data) => {
            this.taskOutputs.emit(taskId, data);
            this.taskPid.delete(taskId);
            this.tasks.delete(taskId);
            this.checkOutProcess(proc.pid);
          });
          this.taskPid.set(taskId, proc.pid);
          proc.send(this.tasks.get(taskId));
        } else {
          this.events.emit('newTask', taskId);
        }
      });
    });

    if (processCount != undefined) {
      this.processCount = processCount;
      for (let i = 0; i < processCount; i++) {
        this.processes.push(
          cp.fork(__dirname + '/worker.js', [], { silent: true }),
        );
      }
    } else {
      this.processCount = 1;
      this.processes.push(
        cp.fork(__dirname + '/worker.js', [], { silent: true }),
      );
    }
  }

  /**
   * Adds a new task to be processed and returns a promise that resolves to
   * the code context
   * @param code The Javascript code to execute
   * @param context Context for the code. These will be serialized and made
   * available to the code.
   * @param timeout The execution timeout
   * @returns A Promise that resolves to the Task Id or rejects
   */
  public async execTask(
    taskId: string,
    code: string,
    context: Hashmap,
    timeout: number,
  ): Promise<Hashmap> {
    if (this.isDestroyed) throw new Error('Pool is destroyed.');
    let timeoutcb;
    return Promise.race([
      new Promise((resolve, reject) => {
        this.tasks.set(taskId, new Task(code, context, timeout));
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
          this.checkOutProcess(proc.pid);
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
    for (const taskId of this.tasks.keys()) {
      this.abortEvents.emit(taskId, TaskAbortReason.ABORT);
    }
    for (const proc of this.processes) if (!proc.killed) proc.kill();
    this.processes = null;
    this.taskPid.clear();
    this.taskPid = null;
    this.tasks.clear();
    this.tasks = null;
    this.processes = null;
    this.processCount = null;
    this.events.removeAllListeners();
    this.events = null;
    this.abortEvents.removeAllListeners();
    this.abortEvents = null;
    this.taskOutputs.removeAllListeners();
    this.taskOutputs = null;
  }

  /**
   * Checks if there is any available process and returns it. Otherwise returns
   * undefined.
   * @returns ChildProcess
   */
  private async getProcess(): Promise<cp.ChildProcess> {
    for (const proc of this.processes) {
      if (!this.checkedInProcesses.has(proc.pid)) return proc;
    }
    return undefined;
  }

  /**
   * Checks in a Process, making it unavailable for further task processing
   * @param pid Process Id
   */
  private async checkInProcess(pid: number): Promise<void> {
    this.checkedInProcesses.set(pid, null);
  }

  /**
   * Checks out a Process, making it available for further task processing
   * @param pid Process Id
   */
  private async checkOutProcess(pid: number): Promise<void> {
    if (this.checkedInProcesses.has(pid)) this.checkedInProcesses.delete(pid);
  }

  /**
   * Ensures the required number of processes are available
   */
  private async maintainMinimumProcesses(): Promise<void> {
    for (const proc of this.processes) {
      if (proc.killed) {
        this.processes = this.processes.filter((item) => {
          if (item.pid !== proc.pid) {
            return true;
          }
        });
      }
    }
    if (this.processes.length < this.processCount) {
      for (let i = this.processes.length; i < this.processCount; i++)
        this.processes.push(
          cp.fork(__dirname + '/worker.js', [], { silent: true }),
        );
    }
  }
}
