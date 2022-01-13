export declare enum TaskAbortReason {
    abort = 2,
    timeout = 3
}
export interface IPoolcess {
    execTask: (taskId: string, code: string, context: Record<string, unknown>, timeout: number, args?: Map<string, unknown>) => Promise<Record<string, unknown>>;
    abortTask: (taskId: string, code: number) => void;
}
export declare class Poolcess implements IPoolcess {
    private isDestroyed;
    private readonly tasks;
    private readonly taskPid;
    private processes;
    private readonly processCount;
    private readonly checkedInProcesses;
    private readonly events;
    private readonly abortEvents;
    private readonly taskOutputs;
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
     * @param args A Map of arguments to pass to the code
     * @returns A Promise that resolves to the Task Id or rejects
     */
    execTask(taskId: string, code: string, context: Record<string, unknown>, timeout: number, args?: Map<string, unknown>): Promise<Record<string, unknown>>;
    /**
     * Aborts the given task. Removes the task from the queue or aborts the
     * execution if already started.
     * @param taskId The task id to abort
     * @param reason The reason for aborting the task
     */
    abortTask(taskId: string, reason: TaskAbortReason): void;
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
