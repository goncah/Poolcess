## Description

[Poolcess](https://github.com/goncalvesh91/Poolcess) is a Promise Child Process Pool that allows for the safe execution of random Javascript code.
It supports timeouts and task cancellation as well as passing/receiving context to/from the code.

The motivation behind this package is the need to force terminate executing code even if the event loop is blocked which is currently not possible with the worker threads. A performance benchmark hasn't been carried out yet to assess if a worker thread pool like Piscina is faster during execution when compared to a child process pool. Worker threads do allow for faster exchange of data as well as faster 'spawn' times but since Poolcess keeps the processes alive the differences should be negligible. Benchmarks and feedback are welcome as well as any issues/suggestions!

## Features
1. Isolated code execution
2. Cancellable code execution even with the event loop blocked on child process
3. Code execution timeout
4. Passing context/arguments to the code.

## Installation

```bash
$ npm i poolcess
```

## Usage

```typescript
import { Poolcess } from 'poolcess';

// Start a pool with 10 child processes
const pool = new Poolcess(10);

// Execute an infinite loop with a timeout of 10s
let context: Hashmap = {}; // Hashmap Interface is exported by poolcess package
pool.execTask(
  randomUUID(), // A Task Id
  'while(1) console.log(1);', // The code to execute
  context, // Context to pass to the code.
  10000).catch((out) => console.log(out.error)); // Prints Timeout after 10s.

// Abort a task
let context: Hashmap = {};
const taskId = randomUUID();
pool.execTask(
  taskId, // A Task Id
  'console.log(1);', // The code to execute
  context, // Context to pass to the code.
  10000).catch((out) => console.log(out.error)); // Prints User Aborted.

pool.abortTask(taskId, TaskAbortReason.ABORT); // TaskAbortReason.ABORT or TaskAbortReason.TIMEOUT

// Passing/Receiving context
let context: Hashmap = {};
context['counter'] = 10;
context['output'] = 0;

const result = await pool.execTask(
  taskId, // A Task Id
  'for(let i=0;i<this.counter;i++) this.output++', // The code to execute
  context, // Context to pass to the code.
  10000).catch((out) => console.log(out.error)); // Prints Timeout.

console.log(result.output) // Prints 10

// Passing arguments to the code
// Comparing two strings
let context: Hashmap = {};
const args: Map<string, any> = new Map();
args.set('stringA', 'testargstring');
args.set('stringB', 'testargstring');
const result = await pool.execTask(
  randomUUID(),
  'if(stringA === stringB) ' +
    'this.outputs.result = true; else this.outputs.result = false',
  context, // Context is still required to save values as code return values are still not implemented
  10000,
  args,
);
console.log(result.output.result) // Prints true

// Sum two numbers
let context: Hashmap = {};
context.outputs = {};
const args: Map<string, any> = new Map();
args.set('varA', 2);
args.set('varB', 12);
const result = await pool.execTask(
  randomUUID(),
  'this.outputs.result = varA + varB',
  context, // Context is still required to save values as code return values are still not implemented
  10000,
  args,
);
console.log(result.output.result) // Prints 14
```
## Clean up resources
[Poolcess](https://github.com/goncalvesh91/Poolcess) provides the method destroy() that will kill any active processes as well as remove/abort all pending/active tasks. No further actions are possible in the pool.

## Test

```bash
# unit tests
$ npm run test
```
## Build

```bash
$ npm run build
```
