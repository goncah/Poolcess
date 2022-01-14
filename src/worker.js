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
    if (data.task.args != undefined) {
      let argMap = JSON.parse(data.task.args, (_key, value) =>{
        if (typeof value === 'object' && value !== null) {
          if (value.dataType === 'Map') {
            return new Map(value.value);
          }
        }
        return value;
      });
      let args = Array.from(argMap.keys()).map((value) => {
        return value;
      });
      let argsContent = Array.from(argMap.values()).map((value) => {
        return value;
      });
      let scriptFn = new AsyncFunction(...args, data.task.code);
      scriptFn = scriptFn.bind(data.task.context);
      data.task.context.return = await scriptFn(...argsContent);
    } else {
      let scriptFn = new AsyncFunction(data.task.code);
      scriptFn = scriptFn.bind(data.task.context);
      data.task.context.return = await scriptFn();
    }
    process.send({ id: data.id, context: data.task.context });
  } catch (error) {
    data.task.context.error = error.message;
    process.send({ id: data.id, context: data.task.context });
  }
});
