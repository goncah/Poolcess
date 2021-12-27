'use strict';
/**
 * Poolcess Worker
 *
 * Author
 * Hugo Gonçalves, hfdsgoncalves@gmail.com
 *
 */
process.on('message', async (data) => {
  try {
    const AsyncFunction = Object.getPrototypeOf(
      async () => void {},
    ).constructor;
    var scriptFn = new AsyncFunction(data.task.code);
    scriptFn = scriptFn.bind(data.task.context);
    await scriptFn();
    process.send({ id: data.id, context: data.task.context });
  } catch (error) {
    data.task.context.error = error.message;
    process.send({ id: data.id, context: data.task.context });
  }
});
