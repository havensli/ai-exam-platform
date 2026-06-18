import { db } from '@/db';
import { notificationLogs } from '@/db/schema';

const APP_KEY = process.env.DINGTALK_APP_KEY!;
const APP_SECRET = process.env.DINGTALK_APP_SECRET!;
const AGENT_ID = process.env.DINGTALK_AGENT_ID!;

interface AccessTokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: AccessTokenCache | null = null;

export async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }
  const res = await fetch(
    `https://oapi.dingtalk.com/gettoken?appkey=${APP_KEY}&appsecret=${APP_SECRET}`
  );
  if (!res.ok) throw new Error(`DingTalk gettoken HTTP ${res.status}`);
  const data = await res.json();
  if (data.errcode !== 0) throw new Error(`DingTalk gettoken error: ${data.errmsg}`);

  tokenCache = { token: data.access_token, expiresAt: Date.now() + 7000 * 1000 };
  return data.access_token;
}

export async function getUserAccessToken(authCode: string): Promise<string> {
  const res = await fetch('https://api.dingtalk.com/v1.0/oauth2/userAccessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: APP_KEY,
      clientSecret: APP_SECRET,
      code: authCode,
      grantType: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`DingTalk userAccessToken HTTP ${res.status}`);
  const data = await res.json();
  if (!data.accessToken) throw new Error(`DingTalk userAccessToken failed: ${JSON.stringify(data)}`);
  return data.accessToken;
}

export interface DingTalkUserInfo {
  userid: string;
  name: string;
  department: string;
  level: string;
}

export async function getUserInfo(userAccessToken: string): Promise<DingTalkUserInfo> {
  const res = await fetch('https://api.dingtalk.com/v1.0/contact/users/me', {
    headers: { 'x-acs-dingtalk-access-token': userAccessToken },
  });
  if (!res.ok) throw new Error(`DingTalk getUserInfo HTTP ${res.status}`);
  const data = await res.json();
  return {
    userid: data.unionId ?? data.openId,
    name: data.nick ?? data.name ?? '',
    department: Array.isArray(data.deptIdList) ? String(data.deptIdList[0] ?? '') : '',
    level: data.title ?? 'junior',
  };
}

export async function sendWorkNotification(
  userIds: string[],
  title: string,
  content: string,
  examId: string,
  employeeDbIds: string[],
): Promise<void> {
  const accessToken = await getAccessToken();
  const BATCH = 100;

  for (let i = 0; i < userIds.length; i += BATCH) {
    const batch = userIds.slice(i, i + BATCH);
    const employeeBatch = employeeDbIds.slice(i, i + BATCH);

    let dingtalkTaskId: string | undefined;
    let status: 'sent' | 'failed' = 'sent';

    try {
      const res = await fetch(
        'https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-acs-dingtalk-access-token': accessToken,
          },
          body: JSON.stringify({
            agent_id: AGENT_ID,
            userid_list: batch.join(','),
            msg: {
              msgtype: 'text',
              text: { content: `${title}\n\n${content}` },
            },
          }),
        }
      );
      const data = await res.json();
      if (data.errcode === 0) {
        dingtalkTaskId = String(data.task_id);
      } else {
        status = 'failed';
      }
    } catch {
      status = 'failed';
    }

    await db.insert(notificationLogs).values(
      employeeBatch.map((empId) => ({
        employeeId: empId,
        type: 'published' as const,
        examId,
        dingtalkTaskId: dingtalkTaskId ?? null,
        status,
      }))
    );
  }
}

/** Single-recipient retry used by the "通知未送达名单" resend action. */
export async function resendToEmployee(dingtalkUserid: string, title: string, content: string): Promise<boolean> {
  try {
    const accessToken = await getAccessToken();
    const res = await fetch(
      'https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-acs-dingtalk-access-token': accessToken,
        },
        body: JSON.stringify({
          agent_id: AGENT_ID,
          userid_list: dingtalkUserid,
          msg: {
            msgtype: 'text',
            text: { content: `${title}\n\n${content}` },
          },
        }),
      }
    );
    const data = await res.json();
    return data.errcode === 0;
  } catch {
    return false;
  }
}
