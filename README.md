## Description

[Poolcess](https://github.com/goncalvesh91/Poolcess) is a Promise Child Process Pool that allows for the safe execution of random Javascript code.
It supports timeouts and task cancellation as well as passing/receiving context to/from the code.

The motivation behind this package is the need to force terminate executing code even if the event loop is blocked which is currently not possible with the worker threads. A performance benchmark hasn't been carried out yet to assess if a worker thread pool like Piscina is faster during execution when compared to a child process pool. Worker threads do allow for faster exchange of data as well as faster 'spawn' times but since Poolcess keeps the processes alive the differences should be negligible. Benchmarks and feedback are welcome as well as any issues/suggestions!

## Features
1. Isolated code execution
2. Cancellable code execution even with the event loop blocked on child process
3. Code execution timeout

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
let context = {};
pool.execTask(
  randomUUID(), // A Task Id
  'while(1) console.log(1);', // The code to execute
  context, // Context to pass to the code.
  10000).catch((out) => console.log(out.error)); // Prints Timeout after 10s.

// Abort a task
let context = {};
const taskId = randomUUID();
pool.execTask(
  taskId, // A Task Id
  'console.log(1);', // The code to execute
  context, // Context to pass to the code.
  10000).catch((out) => console.log(out.error)); // Prints User Aborted.

pool.abortTask(taskId, TaskAbortReason.ABORT); // TaskAbortReason.ABORT or TaskAbortReason.TIMEOUT

// Passing/Receiving context
let context = {};
context['counter'] = 10;
context['output'] = 0;

const result = await pool.execTask(
  taskId, // A Task Id
  'for(let i=0;i<this.counter;i++) this.output++', // The code to execute
  context, // Context to pass to the code.
  10000).catch((out) => console.log(out.error)); // Prints Timeout.

console.log(result.output) // Prints 10
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
