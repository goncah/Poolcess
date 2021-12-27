"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Poolcess = exports.TaskAbortReason = void 0;
const cp = require("child_process");
const events_1 = require("events");
class Task {
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
    constructor(processCount) {
        this.isDestroyed = false;
        this.tasks = new Map();
        this.taskPid = new Map();
        this.processes = [];
        this.processCount = 0;
        this.checkedInProcesses = new Map();
        this.events = new events_1.EventEmitter();
        this.abortEvents = new events_1.EventEmitter();
        this.taskOutputs = new events_1.EventEmitter();
        this.events.setMaxListeners(this.processCount + 1);
        this.abortEvents.setMaxListeners(this.processCount + 1);
        this.taskOutputs.setMaxListeners(this.processCount + 1);
        this.events.on('newTask', (taskId) => {
            if (!this.tasks.has(taskId))
                return;
            this.getProcess().then((proc) => {
                if (proc != undefined) {
                    this.checkInProcess(proc.pid);
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
                    this.events.emit('newTask', taskId);
                }
            });
        });
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
    getActiveProcessesCount() {
        if (this.isDestroyed)
            throw new Error('Pool is destroyed.');
        let count = 0;
        for (const proc of this.processes)
            if (!proc.killed)
                count++;
        return count;
    }
    destroy() {
        if (this.isDestroyed)
            throw new Error('Pool is destroyed already.');
        this.isDestroyed = true;
        for (const taskId of this.tasks.keys()) {
            this.abortEvents.emit(taskId, TaskAbortReason.ABORT);
        }
        for (const proc of this.processes)
            if (!proc.killed)
                proc.kill();
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
    async getProcess() {
        for (const proc of this.processes) {
            if (!this.checkedInProcesses.has(proc.pid))
                return proc;
        }
        return undefined;
    }
    checkInProcess(pid) {
        this.checkedInProcesses.set(pid, null);
    }
    checkOutProcess(pid) {
        if (this.checkedInProcesses.has(pid))
            this.checkedInProcesses.delete(pid);
    }
    async maintainMinimumProcesses() {
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