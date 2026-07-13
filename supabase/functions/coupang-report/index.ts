// 쿠팡 파트너스 리포트 프록시 (Supabase Edge Function)
// - Secret Key는 브라우저에 노출하면 안 되므로 이 서버 함수가 대신 쿠팡 API를 호출한다.
// - 관리자(jejuwatch@gmail.com)로 로그인한 요청만 허용.
// 배포: supabase functions deploy coupang-report
// 비밀값: supabase secrets set COUPANG_ACCESS_KEY=... COUPANG_SECRET_KEY=...
import { createClient } from "npm:@supabase/supabase-js@2";

const ADMIN_EMAIL = "play@soundb.kr";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function coupangCall(kind: string, start: string, end: string) {
  const ACCESS = Deno.env.get("COUPANG_ACCESS_KEY")!;
  const SECRET = Deno.env.get("COUPANG_SECRET_KEY")!;
  const path = `/v2/providers/affiliate_open_api/apis/openapi/v1/reports/${kind}`;
  const query = `startDate=${start}&endDate=${end}`;

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const dt = `${String(now.getUTCFullYear()).slice(2)}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const msg = dt + "GET" + path + query;

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  const sig = [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, "0")).join("");

  const res = await fetch(`https://api-gateway.coupang.com${path}?${query}`, {
    headers: {
      Authorization: `CEA algorithm=HmacSHA256, access-key=${ACCESS}, signed-date=${dt}, signature=${sig}`,
    },
  });
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // 로그인한 관리자인지 확인
  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );
  const { data: { user } } = await supa.auth.getUser();
  if (!user || user.email !== ADMIN_EMAIL) return json({ error: "unauthorized" }, 401);

  const url = new URL(req.url);
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  if (!/^\d{8}$/.test(start ?? "") || !/^\d{8}$/.test(end ?? "")) {
    return json({ error: "start/end must be YYYYMMDD" }, 400);
  }

  try {
    const [clicks, orders, commission] = await Promise.all([
      coupangCall("clicks", start!, end!),
      coupangCall("orders", start!, end!),
      coupangCall("commission", start!, end!),
    ]);
    return json({ clicks, orders, commission });
  } catch (e) {
    return json({ error: String(e) }, 502);
  }
});
