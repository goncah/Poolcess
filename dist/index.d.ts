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
    constructor(processCount?: number);
    execTask(taskId: string, code: string, context: Hashmap, timeout: number): Promise<Hashmap>;
    abortTask(taskId: string, reason: TaskAbortReason): Promise<void>;
    getActiveProcessesCount(): number;
    destroy(): void;
    private getProcess;
    private checkInProcess;
    private checkOutProcess;
    private maintainMinimumProcesses;
}
