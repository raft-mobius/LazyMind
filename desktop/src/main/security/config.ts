export const SECURITY_CONFIG = {
  browserWindow: {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    navigateOnDragDrop: false,
  },

  csp: [
    "default-src 'self' lazymind:",
    "script-src 'self' lazymind:",
    "style-src 'self' lazymind: 'unsafe-inline'",
    "connect-src lazymind: http://127.0.0.1:* https:",
    "img-src 'self' lazymind: data: blob:",
    "font-src 'self' lazymind: data:",
    "object-src 'none'",
    "form-action 'self'",
  ].join('; '),

  allowedChannels: [
    'dialog:pickFolder',
    'shell:openPath',
    'app:getVersion',
    'app:isPackaged',
    'app:getMode',
    'service:getStatus',
    'service:getAllStatus',
    'service:statusChanged',
    'assistant:getCurrent',
    'assistant:setCurrent',
    'assistant:getList',
    'assistant:currentChanged',
    'diagnostics:export',
    'logs:open',
    'data:getDir',
    'credential:set',
    'credential:get',
    'credential:delete',
    'credential:list',
  ] as const,

  localBind: '127.0.0.1' as const,

  allowedOrigins: ['lazymind://app', 'http://localhost:5173'] as const,
} as const;

export type AllowedChannel = (typeof SECURITY_CONFIG.allowedChannels)[number];
