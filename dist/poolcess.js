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
const eventemitter2_1 = require("eventemitter2");
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
        this.events = new eventemitter2_1.EventEmitter2({
            wildcard: false,
            delimiter: '.',
            newListener: false,
            removeListener: false,
            maxListeners: 1,
            verboseMemoryLeak: false,
            ignoreErrors: false,
        });
        this.abortEvents = new eventemitter2_1.EventEmitter2({
            wildcard: false,
            delimiter: '.',
            newListener: false,
            removeListener: false,
            maxListeners: processCount != undefined ? processCount * 2 : 2,
            verboseMemoryLeak: false,
            ignoreErrors: false,
        });
        this.taskOutputs = new eventemitter2_1.EventEmitter2({
            wildcard: false,
            delimiter: '.',
            newListener: false,
            removeListener: false,
            maxListeners: processCount != undefined ? processCount * 2 : 2,
            verboseMemoryLeak: false,
            ignoreErrors: false,
        });
        // Setup newTask listener
        this.events.on('newTask', (taskId) => {
            var _a, _b, _c, _d;
            if (!this.tasks.has(taskId))
                return;
            const PROC = this.getProcess();
            if (PROC != undefined) {
                this.checkInProcess((_a = PROC.pid) !== null && _a !== void 0 ? _a : -1);
                // Available process
                // Setup abort event liteners
                (_b = this.abortEvents) === null || _b === void 0 ? void 0 : _b.once(taskId, (reason) => {
                    var _a, _b;
                    this.taskPid.delete(taskId);
                    this.tasks.delete(taskId);
                    if (reason === TaskAbortReason.abort) {
                        (_a = this.taskOutputs) === null || _a === void 0 ? void 0 : _a.emitAsync(taskId, { error: 'User Aborted.' }).catch((error) => {
                            this.destroy();
                            throw error;
                        });
                    }
                    else {
                        (_b = this.taskOutputs) === null || _b === void 0 ? void 0 : _b.emitAsync(taskId, { error: 'Timeout.' }).catch((error) => {
                            this.destroy();
                            throw error;
                        });
                    }
                    this.maintainMinimumProcesses();
                });
                this.taskPid.set(taskId, (_c = PROC.pid) !== null && _c !== void 0 ? _c : -1);
                PROC.send({ id: taskId, task: this.tasks.get(taskId) });
            }
            else {
                // No process available, process later on
                (_d = this.events) === null || _d === void 0 ? void 0 : _d.emitAsync('newTask', taskId).catch((error) => {
                    this.destroy();
                    throw error;
                });
            }
        });
        // Fork the required processes and set message listeners
        if (processCount != undefined) {
            this.processCount = processCount;
            for (let i = 0; i < processCount; i++) {
                const PROC = (0, child_process_1.fork)(__dirname + '/worker.js', [], { silent: true });
                PROC.on('message', (data) => {
                    var _a, _b;
                    (_a = this.taskOutputs) === null || _a === void 0 ? void 0 : _a.emitAsync(data.id, data.context).catch((error) => {
                        this.destroy();
                        throw error;
                    });
                    this.taskPid.delete(data.id);
                    this.tasks.delete(data.id);
                    this.checkOutProcess((_b = PROC.pid) !== null && _b !== void 0 ? _b : -1);
                });
                this.processes.push(PROC);
            }
        }
        else {
            this.processCount = 1;
            const PROC = (0, child_process_1.fork)(__dirname + '/worker.js', [], { silent: true });
            PROC.on('message', (data) => {
                var _a, _b;
                (_a = this.taskOutputs) === null || _a === void 0 ? void 0 : _a.emitAsync(data.id, data.context).catch((error) => {
                    this.destroy();
                    throw error;
                });
                this.taskPid.delete(data.id);
                this.tasks.delete(data.id);
                this.checkOutProcess((_b = PROC.pid) !== null && _b !== void 0 ? _b : -1);
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
                var _a, _b;
                this.tasks.set(taskId, new Task(code, context, timeout, args));
                const LISTENER = (_a = this.taskOutputs) === null || _a === void 0 ? void 0 : _a.once(taskId, (res) => {
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
                (_b = this.events) === null || _b === void 0 ? void 0 : _b.emitAsync('newTask', taskId).catch((error) => {
                    reject(error);
                    LISTENER.off();
                });
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
        var _a, _b;
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
            (_b = this.abortEvents) === null || _b === void 0 ? void 0 : _b.emitAsync(taskId, reason).catch((error) => {
                this.destroy();
                throw error;
            });
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
        var _a, _b, _c, _d;
        if (this.isDestroyed)
            throw new Error('Pool is destroyed already.');
        this.isDestroyed = true;
        // Abort all tasks so their promises get rejected
        for (const TASKID of this.tasks.keys()) {
            (_a = this.abortEvents) === null || _a === void 0 ? void 0 : _a.emitAsync(TASKID, TaskAbortReason.abort).catch((error) => {
                console.log(error);
            });
        }
        // Kill all cps
        for (const PROC of this.processes)
            if (!PROC.killed)
                PROC.kill();
        // Clear
        this.taskPid.clear();
        this.tasks.clear();
        (_b = this.events) === null || _b === void 0 ? void 0 : _b.removeAllListeners();
        (_c = this.abortEvents) === null || _c === void 0 ? void 0 : _c.removeAllListeners();
        (_d = this.taskOutputs) === null || _d === void 0 ? void 0 : _d.removeAllListeners();
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
                    var _a, _b;
                    (_a = this.taskOutputs) === null || _a === void 0 ? void 0 : _a.emitAsync(data.id, data.context).catch((error) => {
                        this.destroy();
                        throw error;
                    });
                    this.taskPid.delete(data.id);
                    this.tasks.delete(data.id);
                    this.checkOutProcess((_b = PROC.pid) !== null && _b !== void 0 ? _b : -1);
                });
                this.processes.push(PROC);
            }
        }
    }
}
exports.Poolcess = Poolcess;
//# sourceMappingURL=poolcess.js.map