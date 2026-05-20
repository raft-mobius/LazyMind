export const IPC_CHANNELS = {
  DIALOG_PICK_FOLDER: 'dialog:pickFolder',
  SHELL_OPEN_PATH: 'shell:openPath',
  APP_GET_VERSION: 'app:getVersion',
  APP_IS_PACKAGED: 'app:isPackaged',
  APP_GET_MODE: 'app:getMode',
  SERVICE_GET_STATUS: 'service:getStatus',
  SERVICE_GET_ALL_STATUS: 'service:getAllStatus',
  SERVICE_STATUS_CHANGED: 'service:statusChanged',
  ASSISTANT_GET_CURRENT: 'assistant:getCurrent',
  ASSISTANT_SET_CURRENT: 'assistant:setCurrent',
  ASSISTANT_GET_LIST: 'assistant:getList',
  ASSISTANT_CURRENT_CHANGED: 'assistant:currentChanged',
  DIAGNOSTICS_EXPORT: 'diagnostics:export',
  LOGS_OPEN: 'logs:open',
  DATA_GET_DIR: 'data:getDir',
} as const;

export type IPCChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
