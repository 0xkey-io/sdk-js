import { json, queryRecords } from "../_lib";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const txHash = new URL(req.url).searchParams.get("txHash");
    if (!txHash) return json({ error: "txHash is required" }, 400);
    return json(await queryRecords(txHash));
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error ? error.message : "failed to query records",
      },
      500,
    );
  }
}
