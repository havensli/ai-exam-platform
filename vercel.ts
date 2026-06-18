import type { VercelConfig } from '@vercel/config/v1/types';

export const config: VercelConfig = {
  crons: [
    { path: '/api/cron/remind-pending', schedule: '0 * * * *' },
    { path: '/api/cron/check-deadlines', schedule: '0 1 * * *' },
    { path: '/api/cron/sync-employee-status', schedule: '0 1 * * *' },
  ],
};
