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
const cp = require("child_process");
const events_1 = require("events");
class Task {
    /**
     *
     * @param code The Javascript code to execute
     * @param context Context for the code. These will be serialized and made
     * available to the code.
     * @param timeout The execution timeout
     */
    constructor(code, context, timeout) {
        this.code = code;
        this.context = context;
        this.timeout = timeout;
    }
}
var TaskAbortReason;
(function (TaskAbortReason) {
    TaskAbortReason[TaskAbortReason["ABORT"] = 2] = "ABORT";
    TaskAbortReason[TaskAbortReason["TIMEOUT"] = 3] = "TIMEOUT";
})(TaskAbortReason = exports.TaskAbortReason || (exports.TaskAbortReason = {}));
class Poolcess {
    /**
     *
     * @param processCount Number of processes in the pool
     */
    constructor(processCount) {
        this.isDestroyed = false;
        this.tasks = new Map(); // Holds tasks to process
        this.taskPid = new Map(); // Holds task cp pid
        this.processes = []; // Holds the forked cps
        this.processCount = 0; // Init cp count
        this.checkedInProcesses = new Map(); // Holds busy cps
        this.events = new events_1.EventEmitter(); // Emits new task events
        this.abortEvents = new events_1.EventEmitter(); // Emits abort events
        this.taskOutputs = new events_1.EventEmitter(); // Emits task outputs
        this.events.setMaxListeners(this.processCount + 1);
        this.abortEvents.setMaxListeners(this.processCount + 1);
        this.taskOutputs.setMaxListeners(this.processCount + 1);
        // Setup newTask listener
        this.events.on('newTask', (taskId) => {
            if (!this.tasks.has(taskId))
                return;
            this.getProcess().then((proc) => {
                if (proc != undefined) {
                    this.checkInProcess(proc.pid);
                    // Available process
                    // Setup abort event liteners
                    this.abortEvents.once(taskId, (reason) => {
                        this.taskPid.delete(taskId);
                        this.tasks.delete(taskId);
                        if (reason === TaskAbortReason.ABORT) {
                            this.taskOutputs.emit(taskId, { error: 'User Aborted.' });
                        }
                        else if (reason === TaskAbortReason.TIMEOUT) {
                            this.taskOutputs.emit(taskId, { error: 'Timeout.' });
                        }
                        else {
                            this.taskOutputs.emit(taskId, { error: 'Unknown error.' });
                        }
                        this.maintainMinimumProcesses();
                    });
                    this.taskPid.set(taskId, proc.pid);
                    proc.send({ id: taskId, task: this.tasks.get(taskId) });
                }
                else {
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
                proc.on('message', (data) => {
                    this.taskOutputs.emit(data.id, data.context);
                    this.taskPid.delete(data.id);
                    this.tasks.delete(data.id);
                    this.checkOutProcess(proc.pid);
                });
                this.processes.push(proc);
            }
        }
        else {
            this.processCount = 1;
            const proc = cp.fork(__dirname + '/worker.js', [], { silent: true });
            proc.on('message', (data) => {
                this.taskOutputs.emit(data.id, data.context);
                this.taskPid.delete(data.id);
                this.tasks.delete(data.id);
                this.checkOutProcess(proc.pid);
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
     * @returns A Promise that resolves to the Task Id or rejects
     */
    async execTask(taskId, code, context, timeout) {
        if (this.isDestroyed)
            throw new Error('Pool is destroyed.');
        let timeoutcb;
        return Promise.race([
            new Promise((resolve, reject) => {
                this.tasks.set(taskId, new Task(code, context, timeout));
                this.taskOutputs.on(taskId, (res) => {
                    if (res.error != undefined) {
                        clearTimeout(timeoutcb);
                        reject(res);
                    }
                    else {
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
    async abortTask(taskId, reason) {
        if (this.isDestroyed)
            throw new Error('Pool is destroyed.');
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
        for (const proc of this.processes)
            if (!proc.killed)
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
        for (const taskId of this.tasks.keys()) {
            this.abortEvents.emit(taskId, TaskAbortReason.ABORT);
        }
        // Kill all cps
        for (const proc of this.processes)
            if (!proc.killed)
                proc.kill();
        // Clear
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
    async getProcess() {
        for (const proc of this.processes) {
            if (!this.checkedInProcesses.has(proc.pid) && !proc.killed)
                return proc;
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
    async maintainMinimumProcesses() {
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
                proc.on('message', (data) => {
                    this.taskOutputs.emit(data.id, data.context);
                    this.taskPid.delete(data.id);
                    this.tasks.delete(data.id);
                    this.checkOutProcess(proc.pid);
                });
                this.processes.push(proc);
            }
        }
    }
}
exports.Poolcess = Poolcess;
//# sourceMappingURL=index.js.map