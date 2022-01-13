"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Poolcess = exports.TaskAbortReason = void 0;
/**
 * Poolcess
 * A Promise Based Child Process Pool
 *
 * Author
 * Hugo Gonçalves - hfdsgoncalves@gmail.com
 */
const child_process_1 = require("child_process");
const events_1 = require("events");
class Task {
    /**
     *
     * @param code The Javascript code to execute
     * @param context Context for the code. These will be serialized and made
     * available to the code.
     * @param timeout The execution timeout
     * @param args A Map of arguments to pass to the code
     */
    constructor(code, context, timeout, args) {
        this.code = code;
        this.context = context;
        this.timeout = timeout;
        this.args = JSON.stringify(args, (_key, value) => {
            if (value instanceof Map) {
                return {
                    dataType: 'Map',
                    value: Array.from(value.entries()),
                };
            }
            else {
                return value;
            }
        });
    }
}
var TaskAbortReason;
(function (TaskAbortReason) {
    TaskAbortReason[TaskAbortReason["abort"] = 2] = "abort";
    TaskAbortReason[TaskAbortReason["timeout"] = 3] = "timeout";
})(TaskAbortReason = exports.TaskAbortReason || (exports.TaskAbortReason = {}));
class Poolcess {
    /**
     *
     * @param processCount Number of processes in the pool
     */
    constructor(processCount) {
        this.isDestroyed = false;
        this.tasks = new Map();
        this.taskPid = new Map();
        this.processes = [];
        this.checkedInProcesses = new Map();
        this.events = new events_1.EventEmitter();
        this.abortEvents = new events_1.EventEmitter();
        this.taskOutputs = new events_1.EventEmitter();
        // Setup newTask listener
        this.events.on('newTask', (taskId) => {
            var _a, _b;
            if (!this.tasks.has(taskId))
                return;
            const PROC = this.getProcess();
            if (PROC != undefined) {
                this.checkInProcess((_a = PROC.pid) !== null && _a !== void 0 ? _a : -1);
                // Available process
                // Setup abort event liteners
                this.abortEvents.once(taskId, (reason) => {
                    this.taskPid.delete(taskId);
                    this.tasks.delete(taskId);
                    if (reason === TaskAbortReason.abort) {
                        this.taskOutputs.emit(taskId, { error: 'User Aborted.' });
                    }
                    else {
                        this.taskOutputs.emit(taskId, { error: 'Timeout.' });
                    }
                    this.maintainMinimumProcesses();
                });
                this.taskPid.set(taskId, (_b = PROC.pid) !== null && _b !== void 0 ? _b : -1);
                PROC.send({ id: taskId, task: this.tasks.get(taskId) });
            }
            else {
                // No process available, process later on
                this.events.emit('newTask', taskId);
            }
        });
        // Fork the required processes and set message listeners
        if (processCount != undefined) {
            this.processCount = processCount;
            for (let i = 0; i < processCount; i++) {
                const PROC = (0, child_process_1.fork)(__dirname + '/worker.js', [], { silent: true });
                PROC.on('message', (data) => {
                    var _a;
                    this.taskOutputs.emit(data.id, data.context);
                    this.taskPid.delete(data.id);
                    this.tasks.delete(data.id);
                    this.checkOutProcess((_a = PROC.pid) !== null && _a !== void 0 ? _a : -1);
                });
                this.processes.push(PROC);
            }
        }
        else {
            this.processCount = 1;
            const PROC = (0, child_process_1.fork)(__dirname + '/worker.js', [], { silent: true });
            PROC.on('message', (data) => {
                var _a;
                this.taskOutputs.emit(data.id, data.context);
                this.taskPid.delete(data.id);
                this.tasks.delete(data.id);
                this.checkOutProcess((_a = PROC.pid) !== null && _a !== void 0 ? _a : -1);
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
    async execTask(taskId, code, context, timeout, args) {
        if (this.isDestroyed)
            throw new Error('Pool is destroyed.');
        let timeoutcb = undefined;
        return Promise.race([
            new Promise((resolve, reject) => {
                this.tasks.set(taskId, new Task(code, context, timeout, args));
                this.taskOutputs.on(taskId, (res) => {
                    if (res.error != undefined) {
                        if (timeoutcb != undefined)
                            clearTimeout(timeoutcb);
                        reject(res);
                    }
                    else {
                        if (timeoutcb != undefined)
                            clearTimeout(timeoutcb);
                        resolve(res);
                    }
                });
                this.events.emit('newTask', taskId);
            }),
            new Promise(() => {
                timeoutcb = setTimeout(() => {
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
    abortTask(taskId, reason) {
        var _a;
        if (this.isDestroyed)
            throw new Error('Pool is destroyed.');
        if (this.taskPid.has(taskId)) {
            const PID = this.taskPid.get(taskId);
            for (const PROC of this.processes) {
                if (PROC.pid === PID) {
                    PROC.kill();
                    this.checkOutProcess((_a = PROC.pid) !== null && _a !== void 0 ? _a : -1);
                }
            }
            this.abortEvents.emit(taskId, reason);
            this.maintainMinimumProcesses();
        }
        else if (this.tasks.has(taskId)) {
            this.tasks.delete(taskId);
        }
    }
    /**
     * Counts the number of active processes
     * @returns Number of active processes
     */
    getActiveProcessesCount() {
        if (this.isDestroyed)
            throw new Error('Pool is destroyed.');
        let count = 0;
        for (const PROC of this.processes)
            if (!PROC.killed)
                count++;
        return count;
    }
    /**
     * Kill all processes and remove any pending tasks.
     */
    destroy() {
        if (this.isDestroyed)
            throw new Error('Pool is destroyed already.');
        this.isDestroyed = true;
        // Abort all tasks so their promises get rejected
        for (const TASKID of this.tasks.keys()) {
            this.abortEvents.emit(TASKID, TaskAbortReason.abort);
        }
        // Kill all cps
        for (const PROC of this.processes)
            if (!PROC.killed)
                PROC.kill();
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
    getProcess() {
        var _a;
        for (const PROC of this.processes) {
            if (!this.checkedInProcesses.has((_a = PROC.pid) !== null && _a !== void 0 ? _a : -1) && !PROC.killed)
                return PROC;
        }
        return undefined;
    }
    /**
     * Checks in a Process, making it unavailable for further task processing
     * @param pid Process Id
     */
    checkInProcess(pid) {
        this.checkedInProcesses.set(pid, null);
    }
    /**
     * Checks out a Process, making it available for further task processing
     * @param pid Process Id
     */
    checkOutProcess(pid) {
        if (this.checkedInProcesses.has(pid))
            this.checkedInProcesses.delete(pid);
    }
    /**
     * Ensures the required number of processes are available
     */
    maintainMinimumProcesses() {
        // Filter out any killed cps
        for (const PROC of this.processes) {
            if (PROC.killed) {
                this.processes = this.processes.filter((item) => {
                    if (item.pid !== PROC.pid)
                        return true;
                    return false;
                });
            }
        }
        // Fork more cps if needed
        if (this.processes.length < this.processCount) {
            for (let i = this.processes.length; i < this.processCount; i++) {
                const PROC = (0, child_process_1.fork)(__dirname + '/worker.js', [], { silent: true });
                PROC.on('message', (data) => {
                    var _a;
                    this.taskOutputs.emit(data.id, data.context);
                    this.taskPid.delete(data.id);
                    this.tasks.delete(data.id);
                    this.checkOutProcess((_a = PROC.pid) !== null && _a !== void 0 ? _a : -1);
                });
                this.processes.push(PROC);
            }
        }
    }
}
exports.Poolcess = Poolcess;
//# sourceMappingURL=poolcess.js.map