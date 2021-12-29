'use strict';
/**
 * Poolcess Worker
 *
 * Author
 * Hugo Gonçalves, hfdsgoncalves@gmail.com
 *
 */
function reviver(_key, value) {
  if (typeof value === 'object' && value !== null) {
    if (value.dataType === 'Map') {
      return new Map(value.value);
    }
  }
  return value;
}

process.on('message', async (data) => {
  try {
    const AsyncFunction = Object.getPrototypeOf(
      async () => void {},
    ).constructor;
    if (data.task.args != undefined) {
      let argMap = JSON.parse(data.task.args, reviver);
      var args = Array.from(argMap.keys()).map((value) => {
        return value;
      });
      var argsContent = Array.from(argMap.values()).map((value) => {
        return value;
      });
      var scriptFn = new AsyncFunction(...args, data.task.code);
      scriptFn = scriptFn.bind(data.task.context);
      await scriptFn(...argsContent);
    } else {
      var scriptFn = new AsyncFunction(data.task.code);
      scriptFn = scriptFn.bind(data.task.context);
      await scriptFn();
    }
    process.send({ id: data.id, context: data.task.context });
  } catch (error) {
    data.task.context.error = error.message;
    process.send({ id: data.id, context: data.task.context });
  }
});
