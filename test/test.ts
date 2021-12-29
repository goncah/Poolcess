import { randomUUID } from 'crypto';
import { Hashmap, Poolcess, TaskAbortReason } from '../src';

describe('Poolcess Unit Tests', () => {
  it('Create a pool with 10 child processes', () => {
    const pool = new Poolcess(10);
    const procCount = pool.getActiveProcessesCount();
    pool.destroy();
    expect(procCount).toBe(10);
  });

  it('Test if two strings are equal in a child process', async () => {
    const pool = new Poolcess(1);
    let context: Hashmap = {};
    context.inputs = {};
    context.outputs = {};
    context.inputs.stringA = 'aaa';
    context.inputs.stringB = 'aaa';
    const result = await pool.execTask(
      randomUUID(),
      'if(this.inputs.stringA === this.inputs.stringB) ' +
        'this.outputs.result = true; else this.outputs.result = false',
      context,
      10000,
    );
    pool.destroy();
    expect(result.outputs.result).toBe(true);
  });

  it('Test if two strings are equal in a child process with args', async () => {
    const pool = new Poolcess(1);
    let context: Hashmap = {};
    context.outputs = {};
    const args: Map<string, any> = new Map();
    args.set('stringA', 'testargstring');
    args.set('stringB', 'testargstring');
    const result = await pool.execTask(
      randomUUID(),
      'if(stringA === stringB) ' +
        'this.outputs.result = true; else this.outputs.result = false',
      context,
      10000,
      args,
    );
    pool.destroy();
    expect(result.outputs.result).toBe(true);
  });

  it('Test sum two vars in a child process with args', async () => {
    const pool = new Poolcess(1);
    let context: Hashmap = {};
    context.outputs = {};
    const args: Map<string, any> = new Map();
    args.set('varA', 2);
    args.set('varB', 12);
    const result = await pool.execTask(
      randomUUID(),
      'this.outputs.result = varA + varB',
      context,
      10000,
      args,
    );
    pool.destroy();
    expect(result.outputs.result).toBe(14);
  });

  it('Test a for loop', async () => {
    const pool = new Poolcess(1);
    let context: Hashmap = {};
    context.counter = 10;
    context.output = 0;
    const result = await pool.execTask(
      randomUUID(),
      'for(let i=0;i<this.counter;i++) this.output++',
      context,
      10000,
    );
    pool.destroy();
    expect(result.output).toBe(10);
  });

  it('Test if process handle incorrect syntax code', async () => {
    const pool = new Poolcess(1);
    let context: Hashmap = {};
    context.inputs = {};
    context.inputs.stringA = 'aaa';
    context.inputs.stringB = 'aaa';
    let out: Hashmap = {};
    await pool
      .execTask(randomUUID(), 'console.lo1);', context, 4000)
      .catch((err) => (out = err));
    pool.destroy();
    expect(out.error).toBe("Unexpected token ')'");
  });

  it('Execute an infinite loop with 4sec timeout and throw timeout', async () => {
    const pool = new Poolcess(1);
    let context: Hashmap = {};
    context.inputs = {};
    context.inputs.stringA = 'aaa';
    context.inputs.stringB = 'aaa';
    let out: Hashmap = {};
    await pool
      .execTask(randomUUID(), 'while(1) console.log(1);', context, 4000)
      .catch((err) => (out = err));
    pool.destroy();
    expect(out.error).toBe('Timeout.');
  });

  it('Abort a running task', async () => {
    const pool = new Poolcess(1);
    let context = {};
    const taskId = randomUUID();
    let out: Hashmap = {};
    const t = setTimeout(async () => {
      await pool.abortTask(taskId, TaskAbortReason.ABORT);
    }, 2500);
    await pool
      .execTask(taskId, 'while(1) console.log(1);', context, 10000)
      .catch((err) => (out = err));
    clearTimeout(t);
    pool.destroy();
    expect(out.error).toBe('User Aborted.');
  });
});
