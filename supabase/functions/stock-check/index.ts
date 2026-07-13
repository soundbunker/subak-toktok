// 쿠팡 배너 상품 모니터링 (미배포 상태)
// ⚠️ 한계 (2026-07-14 실측): 파트너스 검색 API는 "매진" 상품도 계속 노출한다 —
//    실제 매진된 땡모반/엘제이드가 검색에 가격과 함께 나옴. 따라서 이 방식은
//    매진 감지가 아니라 "검색 이탈(판매중단·삭제)"과 "가격 변동" 감지에만 유효.
//    상품 페이지 직접 확인은 쿠팡이 봇을 차단(403)하고, 배너는 정적 광고라 품절 표시 없음.
import { createClient } from "npm:@supabase/supabase-js@2";

const PRODUCTS = [
  { short: "cn2Lpz", id: 7338674658, keyword: "12brix 특품 하우스 꿀 수박", name: "12brix 특품 하우스 꿀수박 8-9kg" },
  { short: "cn2M72", id: 9561256360, keyword: "무등산 수박", name: "무등산 수박 고령 우곡수박 3kg" },
  { short: "cn2M80", id: 9496444577, keyword: "허니삼구 흑수박", name: "허니삼구 하우스 꿀수박 흑수박 8-9kg" },
  { short: "cn2LTZ", id: 6636183181, keyword: "나누담 수박 보관통", name: "나누담 수박 보관통 밀폐용기 2L 2개" },
  { short: "cn2NVn", id: 8855479525, keyword: "냉동 수박주스 땡모반", name: "냉동 수박주스 1kg x 10개 땡모반" },
  { short: "cn2NWc", id: 8096372952, keyword: "무가당 HPP 수박주스", name: "무가당 HPP 수박주스 냉동 1kg 2개" },
];

async function search(keyword: string) {
  const ACCESS = Deno.env.get("COUPANG_ACCESS_KEY")!;
  const SECRET = Deno.env.get("COUPANG_SECRET_KEY")!;
  const path = "/v2/providers/affiliate_open_api/apis/openapi/products/search";
  const query = `keyword=${encodeURIComponent(keyword)}&limit=10`;
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
    headers: { Authorization: `CEA algorithm=HmacSHA256, access-key=${ACCESS}, signed-date=${dt}, signature=${sig}` },
  });
  const body = await res.json();
  return body?.data?.productData ?? [];
}

Deno.serve(async (req) => {
  const token = req.headers.get("x-stock-token") ?? new URL(req.url).searchParams.get("token");
  if (token !== Deno.env.get("STOCK_CHECK_TOKEN")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const results = [];
  for (const p of PRODUCTS) {
    try {
      const items = await search(p.keyword);
      const found = items.find((i: { productId: number }) => Number(i.productId) === p.id);
      results.push({
        short: p.short, id: p.id, name: p.name,
        inStock: !!found,
        price: found ? Number(found.productPrice) : null,
      });
    } catch (e) {
      results.push({ short: p.short, id: p.id, name: p.name, inStock: null, price: null, error: String(e) });
    }
    await new Promise((r) => setTimeout(r, 500)); // API 과호출 방지
  }

  const soldOut = results.filter((r) => r.inStock === false);

  // service role로 기록 (RLS 우회 — 이 함수만 쓰기 가능)
  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  await supa.from("stock_checks").insert({ sold_out: soldOut.length, results });

  return new Response(
    JSON.stringify({ checkedAt: new Date().toISOString(), soldOutCount: soldOut.length, soldOut, results }),
    { headers: { "Content-Type": "application/json" } },
  );
});
