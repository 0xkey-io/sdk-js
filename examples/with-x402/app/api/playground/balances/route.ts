import { json, readBalances } from "../_lib";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const buyer = new URL(req.url).searchParams.get("buyer");
    return json(await readBalances(buyer as `0x${string}` | undefined));
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error ? error.message : "failed to read balances",
      },
      500,
    );
  }
}
