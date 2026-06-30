// Weekly Sweep — Sunday CRON: fires the cloud Gmail sweep in the broker.
// (Separate file because main.ts already holds the HTTP trigger.)
export default async function () {
  const r = await fetch(
    "https://jackhaswell--d2797fbe73eb11f1b6dd1607ee4eb77e.web.val.run/run-gmail",
    { method: "POST", headers: { "X-Sweep-Pass": Deno.env.get("SWEEP_PASS")! } },
  );
  return await r.text();
}
