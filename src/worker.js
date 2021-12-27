'use strict';
/**
 * Poolcess Worker
 *
 * Author
 * Hugo Gonçalves, hfdsgoncalves@gmail.com
 *
 */
process.on('message', async (task) => {
  try {
    const AsyncFunction = Object.getPrototypeOf(
      async () => void {},
    ).constructor;
    var scriptFn = new AsyncFunction(task.code);
    scriptFn = scriptFn.bind(task.context);
    await scriptFn();
    process.send(task.context);
  } catch (error) {
    task.context.error = error.message;
    process.send(task.context);
  }
});
