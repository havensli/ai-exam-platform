import type { VercelConfig } from '@vercel/config/v1/types';

export const config: VercelConfig = {
  // Vercel Hobby plan allows at most one cron run per day per job, so
  // remind-pending (originally hourly) runs once daily instead. Revert to
  // '0 * * * *' if the project is on a Pro plan or above.
  crons: [
    { path: '/api/cron/remind-pending', schedule: '0 9 * * *' },
    { path: '/api/cron/check-deadlines', schedule: '0 1 * * *' },
    { path: '/api/cron/sync-employee-status', schedule: '0 1 * * *' },
  ],
};
