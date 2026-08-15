import { headers } from "next/headers";

export type ChatGPTUser = {
  id: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

function emailSet(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));
}

function secretsMatch(actual: string | null, expected: string | undefined) {
  if (!actual || !expected || actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const requestHeaders = await headers();
  const email = requestHeaders.get("x-redcourt-staff-email")?.trim().toLowerCase();
  if (!email) return null;
  return { id: email, displayName: email, email, fullName: null };
}

export async function requireApiStaff(options: { admin?: boolean } = {}): Promise<Response | null> {
  const requestHeaders = await headers();
  if (!process.env.REDCOURT_API_KEY) {
    return Response.json({ error: "REDCOURT_API_KEY is not configured on the backend." }, { status: 503 });
  }
  if (!secretsMatch(requestHeaders.get("x-redcourt-api-key"), process.env.REDCOURT_API_KEY)) {
    return Response.json({ error: "Unauthorized API client." }, { status: 401 });
  }

  const user = await getChatGPTUser();
  const staffEmails = emailSet(process.env.REDCOURT_STAFF_EMAILS);
  const adminEmails = emailSet(process.env.REDCOURT_ADMIN_EMAILS);
  const configured = staffEmails.size > 0 || adminEmails.size > 0;
  if (!configured) return Response.json({ error: "RedCourt staff access has not been configured." }, { status: 503 });
  if (!user) return Response.json({ error: "A staff identity is required." }, { status: 401 });
  const admin = adminEmails.has(user.email);
  if (!staffEmails.has(user.email) && !admin) return Response.json({ error: "This account is not approved for RedCourt staff access." }, { status: 403 });
  if (options.admin && !admin) return Response.json({ error: "Administrator access is required for this action." }, { status: 403 });
  return null;
}
