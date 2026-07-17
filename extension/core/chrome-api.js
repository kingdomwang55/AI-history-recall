(() => {
  function createChromeApi(options = {}) {
    const chromeApi = options.chrome || globalThis.chrome;
    const scheduleTimeout = options.setTimeout || globalThis.setTimeout;
    const cancelTimeout = options.clearTimeout || globalThis.clearTimeout;
    const now = options.now || Date.now;

    function runtimeError() {
      return chromeApi.runtime.lastError;
    }

    function sendTabMessage(tabId, message, timeoutMs = 60000) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const timer = scheduleTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error("Timed out waiting for content script response."));
        }, timeoutMs);

        chromeApi.tabs.sendMessage(tabId, message, (response) => {
          const error = runtimeError();
          if (settled) return;
          settled = true;
          cancelTimeout(timer);
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve(response);
        });
      });
    }

    function createTab(tabOptions) {
      return new Promise((resolve, reject) => {
        chromeApi.tabs.create(tabOptions, (tab) => {
          const error = runtimeError();
          if (error) reject(new Error(error.message));
          else resolve(tab);
        });
      });
    }

    function queryTabs(queryInfo) {
      return new Promise((resolve) => {
        chromeApi.tabs.query(queryInfo, (tabs) => resolve(tabs || []));
      });
    }

    function updateTab(tabId, updateProperties) {
      return new Promise((resolve, reject) => {
        chromeApi.tabs.update(tabId, updateProperties, (tab) => {
          const error = runtimeError();
          if (error) reject(new Error(error.message));
          else resolve(tab);
        });
      });
    }

    function getTab(tabId) {
      return new Promise((resolve, reject) => {
        chromeApi.tabs.get(tabId, (tab) => {
          const error = runtimeError();
          if (error) reject(new Error(error.message));
          else resolve(tab);
        });
      });
    }

    function removeTab(tabId) {
      return new Promise((resolve, reject) => {
        chromeApi.tabs.remove(tabId, () => {
          const error = runtimeError();
          if (error) reject(new Error(error.message));
          else resolve();
        });
      });
    }

    function getWindow(windowId) {
      return new Promise((resolve, reject) => {
        chromeApi.windows.get(windowId, (browserWindow) => {
          const error = runtimeError();
          if (error) reject(new Error(error.message));
          else resolve(browserWindow);
        });
      });
    }

    function createWindow(windowOptions) {
      return new Promise((resolve, reject) => {
        chromeApi.windows.create(windowOptions, (createdWindow) => {
          const error = runtimeError();
          if (error) reject(new Error(error.message));
          else resolve(createdWindow);
        });
      });
    }

    function removeWindow(windowId) {
      return new Promise((resolve, reject) => {
        chromeApi.windows.remove(windowId, () => {
          const error = runtimeError();
          if (error) reject(new Error(error.message));
          else resolve();
        });
      });
    }

    function waitForTabComplete(tabId, timeoutMs = 45000) {
      return new Promise((resolve, reject) => {
        const started = now();
        const timer = scheduleTimeout(() => {
          chromeApi.tabs.onUpdated.removeListener(listener);
          reject(new Error("Timed out waiting for tab load."));
        }, timeoutMs);

        function listener(updatedTabId, changeInfo) {
          if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
          cancelTimeout(timer);
          chromeApi.tabs.onUpdated.removeListener(listener);
          resolve();
        }

        chromeApi.tabs.onUpdated.addListener(listener);
        chromeApi.tabs.get(tabId, (tab) => {
          if (runtimeError()) return;
          if (tab.status === "complete" || now() - started > timeoutMs) {
            cancelTimeout(timer);
            chromeApi.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        });
      });
    }

    return Object.freeze({
      storage: Object.freeze({
        get: (keys) => chromeApi.storage.local.get(keys),
        set: (items) => chromeApi.storage.local.set(items),
        remove: (keys) => chromeApi.storage.local.remove(keys)
      }),
      alarms: Object.freeze({
        create: (name, alarmInfo) => chromeApi.alarms.create(name, alarmInfo),
        clear: (name) => chromeApi.alarms.clear(name),
        onAlarm: (listener) => chromeApi.alarms.onAlarm.addListener(listener)
      }),
      sendTabMessage,
      createTab,
      queryTabs,
      updateTab,
      getTab,
      removeTab,
      getWindow,
      createWindow,
      removeWindow,
      waitForTabComplete,
      executeScript: (details) => chromeApi.scripting.executeScript(details),
      runtimeUrl: (path) => chromeApi.runtime.getURL(path),
      reload: () => chromeApi.runtime.reload(),
      onMessage: (listener) => chromeApi.runtime.onMessage.addListener(listener),
      onStartup: (listener) => chromeApi.runtime.onStartup.addListener(listener),
      onInstalled: (listener) => chromeApi.runtime.onInstalled.addListener(listener),
      onTabUpdated: (listener) => chromeApi.tabs.onUpdated.addListener(listener),
      onTabRemoved: (listener) => chromeApi.tabs.onRemoved.addListener(listener)
    });
  }

  const defaultApi = globalThis.chrome ? createChromeApi() : {};
  globalThis.AIHR_CHROME_API = Object.freeze({ createChromeApi, ...defaultApi });
})();
