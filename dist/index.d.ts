export declare enum TaskAbortReason {
    ABORT = 2,
    TIMEOUT = 3
}
export interface Hashmap {
    [key: string]: any;
}
export interface IPoolcess {
    execTask(taskId: string, code: string, context: Hashmap, timeout: number): Promise<Hashmap>;
    abortTask(taskId: string, code: number): Promise<void>;
}
export declare class Poolcess implements IPoolcess {
    private isDestroyed;
    private tasks;
    private taskPid;
    private processes;
    private processCount;
    private checkedInProcesses;
    private events;
    private abortEvents;
    private taskOutputs;
    /**
     *
     * @param processCount Number of processes in the pool
     */
    constructor(processCount?: number);
    /**
     * Adds a new task to be processed and returns a promise that resolves to
     * the code context
     * @param code The Javascript code to execute
     * @param context Context for the code. These will be serialized and made
     * available to the code.
     * @param timeout The execution timeout
     * @returns A Promise that resolves to the Task Id or rejects
     */
    execTask(taskId: string, code: string, context: Hashmap, timeout: number): Promise<Hashmap>;
    /**
     * Aborts the given task. Removes the task from the queue or aborts the
     * execution if already started.
     * @param taskId The task id to abort
     * @param reason The reason for aborting the task
     */
    abortTask(taskId: string, reason: TaskAbortReason): Promise<void>;
    /**
     * Counts the number of active processes
     * @returns Number of active processes
     */
    getActiveProcessesCount(): number;
    /**
     * Kill all processes and remove any pending tasks.
     */
    destroy(): void;
    /**
     * Checks if there is any available process and returns it. Otherwise returns
     * undefined.
     * @returns ChildProcess
     */
    private getProcess;
    /**
     * Checks in a Process, making it unavailable for further task processing
     * @param pid Process Id
     */
    private checkInProcess;
    /**
     * Checks out a Process, making it available for further task processing
     * @param pid Process Id
     */
    private checkOutProcess;
    /**
     * Ensures the required number of processes are available
     */
    private maintainMinimumProcesses;
}
